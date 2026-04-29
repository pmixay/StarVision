"""
ai_assistant.py — StarAI: AI assistant that answers questions
and generates UI control commands.
"""

import json
import os
import re
import logging
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple

from dotenv import load_dotenv
import httpx

from satellites import RUSSIAN_CUBESATS, is_operational

load_dotenv(Path(__file__).resolve().with_name(".env"))


# ── Action validation ───────────────────────────────────────────────
# Whitelist of StarAI → UI actions with parameter ranges.
# The AI model is free-form: without a guard the UI would execute any
# structurally-valid JSON it returned, including invalid NORAD IDs,
# out-of-range speeds, or undefined action types. We clamp / drop here
# so the client never has to defend against malformed AI output.

# Cap how many UI actions the model can issue per response. A single
# turn that flips dozens of toggles in a row is almost always a runaway
# generation, not a useful command — so we keep the surface predictable
# for the user.
MAX_ACTIONS_PER_RESPONSE = 8


def _operational_norads() -> set:
    """Build the operational-NORAD set lazily from the live catalog so
    edits to satellites.py (status flips, new launches) are picked up
    without bumping a parallel module-level constant."""
    return {s.norad_id for s in RUSSIAN_CUBESATS if is_operational(s.status)}


def _all_norads() -> set:
    return {s.norad_id for s in RUSSIAN_CUBESATS}


def _known_constellations() -> set:
    return {s.constellation for s in RUSSIAN_CUBESATS}


def _clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


def _validate_action(action: Dict[str, Any]) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    """Return (validated_action, error). The error is a user-visible
    string explaining why an action was dropped — None if accepted.
    """
    if not isinstance(action, dict):
        return None, "action is not an object"
    atype = action.get("type")
    if not isinstance(atype, str):
        return None, "action.type missing"

    if atype == "focus_satellite":
        nid = action.get("norad_id")
        if not isinstance(nid, int):
            return None, "focus_satellite.norad_id must be an integer"
        if nid not in _all_norads():
            return None, f"focus_satellite: unknown NORAD {nid}"
        if nid not in _operational_norads():
            # Archival satellites cannot be tracked live.
            return None, f"focus_satellite: NORAD {nid} is archival (not operational)"
        return {"type": "focus_satellite", "norad_id": nid}, None

    if atype == "set_time_speed":
        speed = action.get("speed")
        if not isinstance(speed, (int, float)):
            return None, "set_time_speed.speed must be numeric"
        return {"type": "set_time_speed", "speed": int(_clamp(speed, 1, 200))}, None

    if atype in ("toggle_orbits", "toggle_links", "toggle_coverage", "toggle_labels"):
        visible = action.get("visible")
        if not isinstance(visible, bool):
            return None, f"{atype}.visible must be boolean"
        return {"type": atype, "visible": visible}, None

    if atype == "highlight_constellation":
        name = action.get("name")
        if not isinstance(name, str):
            return None, "highlight_constellation.name must be string"
        if name not in _known_constellations():
            return None, f"highlight_constellation: unknown group '{name}'"
        return {"type": "highlight_constellation", "name": name}, None

    if atype == "set_satellite_count":
        count = action.get("count")
        if not isinstance(count, (int, float)):
            return None, "set_satellite_count.count must be numeric"
        return {"type": "set_satellite_count", "count": int(_clamp(count, 3, 15))}, None

    if atype == "set_comm_range":
        rng = action.get("range_km")
        if not isinstance(rng, (int, float)):
            return None, "set_comm_range.range_km must be numeric"
        return {"type": "set_comm_range", "range_km": int(_clamp(rng, 50, 2000))}, None

    if atype == "set_orbit_altitude":
        alt = action.get("altitude_km")
        if not isinstance(alt, (int, float)):
            return None, "set_orbit_altitude.altitude_km must be numeric"
        # 0 = real TLE, 400..2000 = virtual
        alt = 0 if alt <= 0 else int(_clamp(alt, 400, 2000))
        return {"type": "set_orbit_altitude", "altitude_km": alt}, None

    if atype == "set_orbital_planes":
        planes = action.get("planes")
        if not isinstance(planes, (int, float)):
            return None, "set_orbital_planes.planes must be numeric"
        return {"type": "set_orbital_planes", "planes": int(_clamp(planes, 1, 7))}, None

    if atype == "reset_view":
        return {"type": "reset_view"}, None

    return None, f"unknown action type '{atype}'"


def validate_actions(actions: List[Any]) -> Tuple[List[Dict[str, Any]], List[str]]:
    """Validate a list of actions. Returns (accepted, rejected_reasons)."""
    if not isinstance(actions, list):
        return [], ["actions must be a list"]
    accepted: List[Dict[str, Any]] = []
    rejected: List[str] = []
    for action in actions[:MAX_ACTIONS_PER_RESPONSE]:
        validated, err = _validate_action(action)
        if validated is not None:
            accepted.append(validated)
        elif err:
            rejected.append(err)
    overflow = len(actions) - MAX_ACTIONS_PER_RESPONSE
    if overflow > 0:
        rejected.append(f"dropped {overflow} trailing actions (cap={MAX_ACTIONS_PER_RESPONSE})")
    return accepted, rejected

# Anthropic API (via HTTP, no SDK — for simplicity)
ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_DEFAULT_MODEL = "claude-sonnet-4-20250514"

# OpenRouter — OpenAI-compatible gateway. The key is stored server-side in
# backend/.env so the browser never receives or forwards it.
OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions"
OPENROUTER_MODEL = "openai/gpt-oss-120b"


def _env(name: str) -> str:
    return os.getenv(name, "").strip()


def _get_anthropic_api_key() -> str:
    return _env("ANTHROPIC_API_KEY")


def _get_anthropic_model() -> str:
    return _env("ANTHROPIC_MODEL") or ANTHROPIC_DEFAULT_MODEL


def _get_openrouter_api_key() -> str:
    return _env("OPENROUTER_API_KEY")


def _get_openrouter_model(_model: Optional[str] = None) -> str:
    """Return the fixed OpenRouter model.

    `_model` is intentionally ignored: StarAI must not be switched to a
    different provider model via client input or environment overrides.
    """
    return OPENROUTER_MODEL

SYSTEM_PROMPT_BASE = """You are StarAI, the intelligent assistant of the StarVision project.
StarVision is a digital twin of a constellation of Russian cubesats and small spacecraft.

Your capabilities:
1. Answer questions about satellites, orbital mechanics, Russian and global space programs.
2. Control the visualization interface via special commands.
3. Explain physics of orbital motion, Kepler's laws, SGP4 model.
4. Compare constellations (Starlink, OneWeb, Sfera, etc.).
5. Explain inter-satellite links, their principles and limitations.

RESPONSE FORMAT — strictly JSON:
{{
  "message": "Response text to user",
  "actions": [
    // Optional. Array of interface commands:
    // {{"type": "focus_satellite", "norad_id": 56200}}
    // {{"type": "set_time_speed", "speed": 10}}
    // {{"type": "toggle_orbits", "visible": true}}
    // {{"type": "toggle_links", "visible": true}}
    // {{"type": "toggle_coverage", "visible": true}}
    // {{"type": "toggle_labels", "visible": true}}
    // {{"type": "highlight_constellation", "name": "УниверСат"}}
    // {{"type": "set_satellite_count", "count": 10}}
    // {{"type": "set_comm_range", "range_km": 800}}
    // {{"type": "set_orbit_altitude", "altitude_km": 600}}
    // {{"type": "set_orbital_planes", "planes": 3}}
    // {{"type": "reset_view"}}
  ]
}}

Russian CubeSats in the system (NORAD ID):
- UniverSat program: Dekart (46493), NORBI (46494), NORBI-2 (57179), SamSat-Ionosphere (61784)
- Bauman MSTU: Yarilo-1 (46490), UmKA-1 (57172), Yarilo-3 (57198)
- SPUTNIX/HSE: CubeSX-HSE (47952), CubeSX-HSE-3 (57178)
- Geoscan: Geoscan-Edelveis (53385, deorbited)
- SINP MSU: Monitor-2 (57184)
- Space-Pi: TUSUR GO (61782), RTU MIREA-1 (61785), Horizont (61757), ASRTU-1 (61781)

{lang_instruction}
Be friendly, informative, and passionate about space.
If the user asks to show a satellite — use action focus_satellite with the correct norad_id.
If they ask to speed up/slow down — set_time_speed.
If they ask about count — use set_satellite_count.
If they ask about links — toggle_links and/or set_comm_range.
If they ask about orbit — toggle_orbits and/or set_orbit_altitude.
If they ask about coverage/footprint — toggle_coverage.
If they ask about orbital planes — set_orbital_planes.
"""

LANG_INSTRUCTIONS = {
    "ru": "Всегда отвечай на русском языке.",
    "en": "Always respond in English.",
}


def _build_system_prompt(lang: str = "ru") -> str:
    instruction = LANG_INSTRUCTIONS.get(lang, LANG_INSTRUCTIONS["ru"])
    return SYSTEM_PROMPT_BASE.format(lang_instruction=instruction)


_JSON_DECODER = json.JSONDecoder()


def _is_ai_response_object(obj: Any) -> bool:
    if not isinstance(obj, dict):
        return False
    return isinstance(obj.get("message"), str) or isinstance(obj.get("actions"), list)


def _scan_first_ai_response_object(text: str) -> Optional[Dict[str, Any]]:
    """Walk the string, asking the JSON decoder to consume an object at
    each '{' until one parses cleanly. Avoids the previous greedy regex
    that could splice two unrelated JSON blobs together. Non-StarAI JSON
    objects are skipped so a diagnostic blob cannot hide the real reply."""
    idx = 0
    while True:
        start = text.find("{", idx)
        if start == -1:
            return None
        try:
            obj, end = _JSON_DECODER.raw_decode(text, start)
        except json.JSONDecodeError:
            idx = start + 1
            continue
        if _is_ai_response_object(obj):
            return obj
        idx = end


def _load_ai_response_object(text: str) -> Optional[Dict[str, Any]]:
    try:
        obj = json.loads(text)
    except json.JSONDecodeError:
        return None
    return obj if _is_ai_response_object(obj) else None


def _response_message(parsed: Dict[str, Any], fallback: str) -> str:
    message = parsed.get("message")
    return message if isinstance(message, str) else fallback


def _parse_ai_response(text: str) -> Optional[Dict[str, Any]]:
    """Best-effort JSON extraction from a model response. Models often
    wrap JSON in ```json … ``` fences or surround it with prose."""
    loaded = _load_ai_response_object(text)
    if loaded is not None:
        return loaded
    fence_match = re.search(r'```(?:json)?\s*([\s\S]*?)```', text)
    if fence_match:
        fenced = fence_match.group(1).strip()
        loaded = _load_ai_response_object(fenced)
        if loaded is not None:
            return loaded
        scanned = _scan_first_ai_response_object(fenced)
        if scanned is not None:
            return scanned
    return _scan_first_ai_response_object(text)


async def _ask_anthropic(
    user_message: str,
    history: List[Dict[str, str]],
    lang: str,
    api_key: str,
) -> Dict[str, Any]:
    messages = list(history) + [{"role": "user", "content": user_message}]
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            ANTHROPIC_API_URL,
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": _get_anthropic_model(),
                "max_tokens": 1024,
                "system": _build_system_prompt(lang),
                "messages": messages,
            },
        )
        response.raise_for_status()
        data = response.json()

    text = "".join(
        block.get("text", "")
        for block in data.get("content", [])
        if block.get("type") == "text"
    )
    parsed = _parse_ai_response(text)
    if parsed is None:
        return _wrap_response(text, [], lang=lang, source="anthropic")
    return _wrap_response(
        _response_message(parsed, text),
        parsed.get("actions", []),
        lang=lang,
        source="anthropic",
    )


async def _ask_openrouter(
    user_message: str,
    history: List[Dict[str, str]],
    lang: str,
    api_key: str,
    model: Optional[str],
) -> Dict[str, Any]:
    """Call OpenRouter (OpenAI-compatible). The system prompt goes as a
    system role message; assistant/user history is forwarded as-is.
    """
    chosen_model = _get_openrouter_model(model)
    messages: List[Dict[str, str]] = [
        {"role": "system", "content": _build_system_prompt(lang)},
    ]
    messages.extend(history)
    messages.append({"role": "user", "content": user_message})

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            OPENROUTER_API_URL,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                # OpenRouter uses these for model attribution / leaderboard.
                "HTTP-Referer": "https://github.com/starvision",
                "X-Title": "StarVision",
            },
            json={
                "model": chosen_model,
                "messages": messages,
                "max_tokens": 1024,
                # Some OpenRouter providers honour this hint and skip prose.
                "response_format": {"type": "json_object"},
            },
        )
        response.raise_for_status()
        data = response.json()

    choices = data.get("choices") or []
    text = ""
    if choices:
        msg = choices[0].get("message") or {}
        text = msg.get("content") or ""
    parsed = _parse_ai_response(text)
    if parsed is None:
        return _wrap_response(text, [], lang=lang, source="openrouter")
    return _wrap_response(
        _response_message(parsed, text),
        parsed.get("actions", []),
        lang=lang,
        source="openrouter",
    )


async def ask_starai(
    user_message: str,
    conversation_history: List[Dict[str, str]] = None,
    lang: str = "ru",
) -> Dict[str, Any]:
    """Send a message to StarAI and receive response + UI commands.

    Provider routing:
    - server-side OPENROUTER_API_KEY -> OpenRouter with fixed model
    - server-side ANTHROPIC_API_KEY -> Claude direct fallback
    - otherwise → offline fallback (canned responses)
    """
    history = list(conversation_history or [])

    # 1. Server-side OpenRouter key from backend/.env.
    openrouter_key = _get_openrouter_api_key()
    if openrouter_key:
        try:
            return await _ask_openrouter(user_message, history, lang, openrouter_key, None)
        except Exception:
            logging.exception("StarAI OpenRouter call failed")
            # Fall through to Anthropic fallback or offline mode.

    # 2. Server-side Anthropic key as fallback.
    anthropic_key = _get_anthropic_api_key()
    if anthropic_key:
        try:
            return await _ask_anthropic(user_message, history, lang, anthropic_key)
        except Exception:
            logging.exception("StarAI Anthropic call failed")
            # Fall through to offline.

    # 3. Fallback canned responses.
    raw = _fallback_response(user_message, lang)
    return _wrap_response(
        raw.get("message", ""),
        raw.get("actions", []),
        lang=lang,
        source="offline",
    )


def _wrap_response(
    message: str,
    actions: List[Any],
    lang: str = "ru",
    source: str = "ok",
) -> Dict[str, Any]:
    """Validate the proposed action list and append a human-readable
    warning to the message when some actions are rejected. The UI shows
    the warning so invalid AI output is never silently dropped.
    """
    accepted, rejected = validate_actions(actions)
    if rejected:
        if lang == "en":
            notice = "\n\n⚠️ Dropped invalid actions: " + "; ".join(rejected)
        else:
            notice = "\n\n⚠️ Отклонены некорректные действия: " + "; ".join(rejected)
        message = (message or "") + notice
    return {
        "message": message,
        "actions": accepted,
        "rejected_actions": rejected,
        "source": source,
    }


def _fallback_response(user_message: str, lang: str = "ru") -> Dict[str, Any]:
    """Offline responses without API key — extended command set."""
    msg_lower = user_message.lower().strip()
    en = lang == "en"

    # ── Greetings ────────────────────────────────────────
    if any(w in msg_lower for w in ["привет", "здравствуй", "хай", "hello", "добрый", "здрасте", "hi ", " hi"]) or msg_lower == "hi":
        return {
            "message": (
                "Hello! ✦ I am StarAI — the intelligent assistant of StarVision. "
                "I can tell you about satellites, control the visualization, "
                "explain orbital mechanics and much more. Ask away!"
                if en else
                "Привет! ✦ Я StarAI — интеллектуальный ассистент StarVision. "
                "Могу рассказать о спутниках, управлять визуализацией, "
                "объяснить орбитальную механику и многое другое. Спрашивай!"
            ),
            "actions": [],
        }

    # ── UniverSat ─────────────────────────────────────────
    if any(w in msg_lower for w in ["универсат", "universat", "норби", "norbi"]):
        return {
            "message": (
                "UniverSat is a Roscosmos program for university CubeSats. "
                "Our model includes: Dekart (MSU, radiation & ADS-B), NORBI/NORBI-2 (NSU, EO & AIS), "
                "SamSat-Ionosphere (Samara Univ., ionosphere sounding). Showing UniverSat constellation."
                if en else
                "«УниверСат» — программа Роскосмоса по запуску университетских кубсатов. "
                "В нашей модели: Декарт (МГУ, радиация и ADS-B), НОРБИ/НОРБИ-2 (НГУ, ДЗЗ и AIS), "
                "СамСат-Ионосфера (Самарский ун-т, зондирование ионосферы). Показываю группу."
            ),
            "actions": [{"type": "highlight_constellation", "name": "УниверСат"}],
        }

    # ── Dekart ───────────────────────────────────────────
    if any(w in msg_lower for w in ["декарт", "dekart"]):
        return {
            "message": (
                "Dekart is a 3U CubeSat (~4 kg) by SINP MSU. "
                "Monitors radiation on polar orbits and receives ADS-B signals. "
                "NORAD 46493, launched 2020-09-28. Showing."
                if en else
                "«Декарт» — кубсат 3U (~4 кг) НИИЯФ МГУ. "
                "Мониторинг радиационной обстановки на полярных орбитах и приём ADS-B. "
                "NORAD 46493, запущен 2020-09-28. Показываю."
            ),
            "actions": [{"type": "focus_satellite", "norad_id": 46493}],
        }

    # ── Bauman MSTU / UmKA / Yarilo ─────────────────────
    if any(w in msg_lower for w in ["бауман", "умка", "мгту", "ярило", "bauman", "umka", "yarilo"]):
        if any(w in msg_lower for w in ["ярило", "yarilo"]):
            return {
                "message": (
                    "Yarilo — a series of CubeSats by Bauman MSTU for solar physics research. "
                    "Yarilo-1 (1.5U, NORAD 46490) and Yarilo-3 (3U, NORAD 57198) measure "
                    "solar energy reflected by Earth and the magnetic field. Showing Yarilo-3."
                    if en else
                    "Ярило — серия кубсатов МГТУ Баумана для исследования Солнца. "
                    "Ярило-1 (1.5U, NORAD 46490) и Ярило-3 (3U, NORAD 57198) измеряют "
                    "солнечную энергию и магнитное поле. Показываю Ярило-3."
                ),
                "actions": [{"type": "focus_satellite", "norad_id": 57198}],
            }
        return {
            "message": (
                "Bauman MSTU CubeSats in our model:\n"
                "• UmKA-1 (3U, ~4 kg) — technology demonstrator, NORAD 57172\n"
                "• Yarilo-1 (1.5U, ~2 kg) — solar research, NORAD 46490\n"
                "• Yarilo-3 (3U, ~4 kg) — solar physics, magnetometry, NORAD 57198\n"
                "Showing UmKA-1."
                if en else
                "Кубсаты МГТУ Баумана в нашей модели:\n"
                "• УмКА-1 (3U, ~4 кг) — технологический демонстратор, NORAD 57172\n"
                "• Ярило-1 (1.5U, ~2 кг) — исследование Солнца, NORAD 46490\n"
                "• Ярило-3 (3U, ~4 кг) — солнечная физика, магнитометрия, NORAD 57198\n"
                "Показываю УмКА-1."
            ),
            "actions": [
                {"type": "highlight_constellation", "name": "МГТУ Баумана"},
                {"type": "focus_satellite", "norad_id": 57172},
            ],
        }

    # ── SPUTNIX / CubeSX / HSE ───────────────────────────
    if any(w in msg_lower for w in ["sputnix", "спутникс", "вшэ", "hse", "cubesx"]):
        return {
            "message": (
                "CubeSX-HSE — a series of 3U CubeSats developed by SPUTNIX and HSE University. "
                "CubeSX-HSE (NORAD 47952) and CubeSX-HSE-3 (NORAD 57178) carry experimental "
                "cameras with Fresnel lenses and X-band transmitters. Showing CubeSX-HSE."
                if en else
                "CubeSX-HSE — серия кубсатов 3U, разработанных SPUTNIX и ВШЭ. "
                "CubeSX-HSE (NORAD 47952) и CubeSX-HSE-3 (NORAD 57178) несут экспериментальные "
                "камеры на линзах Френеля и передатчики X-диапазона. Показываю CubeSX-HSE."
            ),
            "actions": [
                {"type": "highlight_constellation", "name": "SPUTNIX"},
                {"type": "focus_satellite", "norad_id": 47952},
            ],
        }

    # ── Geoscan ──────────────────────────────────────────
    if any(w in msg_lower for w in ["геоскан", "эдельвейс", "geoscan", "edelveis"]):
        return {
            "message": (
                "Geoscan-Edelveis is the first private nanosatellite from St. Petersburg (3U, ~4 kg). "
                "Flight tests of the Geoscan-3U platform with a gas thruster by OKB Fakel. "
                "NORAD 53385. Deorbited 2024-02-18 after 558 days in orbit. Showing."
                if en else
                "Геоскан-Эдельвейс — первый частный наноспутник из Санкт-Петербурга (3U, ~4 кг). "
                "Лётные испытания платформы Геоскан-3U с газовым двигателем ОКБ «Факел». "
                "NORAD 53385. Сведён с орбиты 2024-02-18 после 558 дней полёта. Показываю."
            ),
            "actions": [{"type": "focus_satellite", "norad_id": 53385}],
        }

    # ── Monitor / SINP MSU ───────────────────────────────
    if any(w in msg_lower for w in ["монитор", "ниияф", "monitor", "sinp", "кодиз", "kodiz"]):
        return {
            "message": (
                "Monitor-2 is a 3U CubeSat by SINP MSU for X-ray and gamma-ray observations "
                "of cosmic flares. KODIZ detector onboard. NORAD 57184, launched 2023-06-27. Showing."
                if en else
                "Монитор-2 — кубсат 3U НИИЯФ МГУ для наблюдения космических вспышек "
                "в рентгеновском и гамма-диапазоне. Детектор КОДИЗ на борту. "
                "NORAD 57184, запущен 2023-06-27. Показываю."
            ),
            "actions": [{"type": "focus_satellite", "norad_id": 57184}],
        }

    # ── Space-Pi ─────────────────────────────────────────
    if any(w in msg_lower for w in ["space-pi", "spacepi", "space pi", "тусур", "tusur", "мирэа", "mirea", "горизонт", "horizont", "asrtu"]):
        return {
            "message": (
                "Space-Pi is a Russian educational CubeSat program. Our model includes:\n"
                "• TUSUR GO (NORAD 61782) — Tomsk\n"
                "• RTU MIREA-1 (NORAD 61785) — Moscow\n"
                "• Horizont (NORAD 61757)\n"
                "• ASRTU-1 (NORAD 61781)\n"
                "All launched 2024-11-05 into SSO ~550 km. Showing Space-Pi."
                if en else
                "Space-Pi — российская образовательная программа кубсатов. В нашей модели:\n"
                "• TUSUR GO (NORAD 61782) — ТУСУР, Томск\n"
                "• RTU MIREA-1 (NORAD 61785) — РТУ МИРЭА, Москва\n"
                "• Горизонт (NORAD 61757)\n"
                "• ASRTU-1 (NORAD 61781)\n"
                "Все запущены 2024-11-05 на ССО ~550 км. Показываю Space-Pi."
            ),
            "actions": [{"type": "highlight_constellation", "name": "Space-Pi"}],
        }

    # ── SamSat ───────────────────────────────────────────
    if any(w in msg_lower for w in ["самсат", "самар", "ионосфер", "samsat", "samara", "ionospher"]):
        return {
            "message": (
                "SamSat-Ionosphere is a 3U CubeSat by Samara University for ionosphere research. "
                "Part of the UniverSat program. NORAD 61784, launched 2024-11-05. Showing."
                if en else
                "СамСат-Ионосфера — кубсат 3U Самарского университета для исследования ионосферы. "
                "Часть программы «УниверСат». NORAD 61784, запущен 2024-11-05. Показываю."
            ),
            "actions": [{"type": "focus_satellite", "norad_id": 61784}],
        }

    # ── Speed control ────────────────────────────────────
    if any(w in msg_lower for w in ["ускор", "быстр", "speed up", "faster"]):
        # Try to extract a number
        nums = re.findall(r'\d+', msg_lower)
        speed = int(nums[0]) if nums else 50
        speed = min(200, max(1, speed))
        return {
            "message": (
                f"Speeding up simulation to {speed}×! Satellites will move faster."
                if en else
                f"Ускоряю симуляцию в {speed}× раз! Спутники будут двигаться быстрее."
            ),
            "actions": [{"type": "set_time_speed", "speed": speed}],
        }

    if any(w in msg_lower for w in ["замедл", "стоп", "пауз", "остано", "медленн", "реальн", "slow", "stop", "pause", "real time"]):
        return {
            "message": (
                "Returning to real time (1×)."
                if en else
                "Возвращаю реальное время (1×)."
            ),
            "actions": [{"type": "set_time_speed", "speed": 1}],
        }

    if any(w in msg_lower for w in ["врем", "скорость", "time", "speed"]) and not any(w in msg_lower for w in ["сколько", "какой", "какая", "how many", "what"]):
        nums = re.findall(r'\d+', msg_lower)
        if nums:
            speed = min(200, max(1, int(nums[0])))
            return {
                "message": (
                    f"Setting simulation speed: {speed}×"
                    if en else
                    f"Устанавливаю скорость симуляции: {speed}×"
                ),
                "actions": [{"type": "set_time_speed", "speed": speed}],
            }

    # ── Orbits ───────────────────────────────────────────
    if any(w in msg_lower for w in ["орбит", "трек", "траектор", "orbit", "track", "trajectory"]):
        if any(w in msg_lower for w in ["скры", "убери", "выключ", "спряч", "hide", "off", "disable"]):
            return {
                "message": "Hiding orbital tracks." if en else "Скрываю орбитальные треки.",
                "actions": [{"type": "toggle_orbits", "visible": False}],
            }
        return {
            "message": (
                "Enabling orbital track display. Each line shows the satellite path for one orbit."
                if en else
                "Включаю отображение орбитальных треков. "
                "Каждая линия показывает путь спутника за один виток."
            ),
            "actions": [{"type": "toggle_orbits", "visible": True}],
        }

    # ── ISL links ────────────────────────────────────────
    if any(w in msg_lower for w in ["связ", "линии", "мсс", "isl", "link"]):
        if any(w in msg_lower for w in ["скры", "убери", "выключ", "спряч", "hide", "off", "disable"]):
            return {
                "message": "Hiding inter-satellite links." if en else "Скрываю линии межспутниковой связи.",
                "actions": [{"type": "toggle_links", "visible": False}],
            }
        if any(w in msg_lower for w in ["покаж", "включ", "отобраз", "show", "on", "enable", "display"]):
            return {
                "message": (
                    "Enabling inter-satellite links. Green lines — active connections "
                    "within communication range. Red — satellites almost in range."
                    if en else
                    "Включаю линии межспутниковой связи. Зелёные линии — активные соединения "
                    "в пределах дальности связи. Красные — спутники почти в зоне видимости."
                ),
                "actions": [{"type": "toggle_links", "visible": True}],
            }
        # Informational response about links
        return {
            "message": (
                "Inter-satellite link (ISL) is data transmission between satellites "
                "without ground station relay. In StarVision we model ISL considering:\n"
                "• Distance between satellites (communication range threshold)\n"
                "• Line of sight (link must not intersect Earth)\n"
                "Green lines — active links, red — potential."
                if en else
                "Межспутниковая связь (ISL) — это передача данных между спутниками "
                "без ретрансляции через наземные станции. В StarVision мы моделируем ISL "
                "с учётом:\n"
                "• Расстояния между спутниками (порог дальности связи)\n"
                "• Прямой видимости (линия связи не должна пересекать Землю)\n"
                "Зелёные линии — активные связи, красные — потенциальные."
            ),
            "actions": [{"type": "toggle_links", "visible": True}],
        }

    # ── Satellite count ───────────────────────────────────
    if any(w in msg_lower for w in ["количеств", "сколько спут", "число спут", "добав", "установи", "how many sat", "satellite count", "set satellite", "add satellite"]):
        nums = re.findall(r'\d+', msg_lower)
        if nums:
            count = min(15, max(3, int(nums[0])))
            return {
                "message": (
                    f"Setting {count} satellites in the constellation."
                    if en else
                    f"Устанавливаю {count} спутников в группировке."
                ),
                "actions": [{"type": "set_satellite_count", "count": count}],
            }
        return {
            "message": (
                "Currently the model displays up to 15 real Russian satellites. "
                "You can change the count from 3 to 15 via the slider or tell me, "
                "e.g.: 'Set 10 satellites'."
                if en else
                "Сейчас в модели отображается до 15 реальных российских спутников. "
                "Ты можешь изменить количество от 3 до 15 через ползунок или сказать мне, "
                "например: «Установи 10 спутников»."
            ),
            "actions": [],
        }

    # ── Communication range ───────────────────────────────
    if any(w in msg_lower for w in ["дальност", "радиус связ", "зона связ", "comm range", "communication range"]):
        nums = re.findall(r'\d+', msg_lower)
        if nums:
            rng = min(2000, max(50, int(nums[0])))
            return {
                "message": (
                    f"Setting communication range: {rng} km. "
                    "Links will be displayed between satellites "
                    "within this distance threshold."
                    if en else
                    f"Устанавливаю дальность связи: {rng} км. "
                    "Линии связи будут отображаться между спутниками, "
                    "расстояние между которыми не превышает этот порог."
                ),
                "actions": [{"type": "set_comm_range", "range_km": rng}],
            }
        return {
            "message": (
                "Communication range defines the maximum distance between satellites "
                "for establishing a connection. Typical values: 500–1500 km for LEO."
                if en else
                "Дальность связи определяет максимальное расстояние между спутниками "
                "для установления соединения. Типичные значения: 500–1500 км для LEO."
            ),
            "actions": [],
        }

    # ── Coverage zones ────────────────────────────────────
    if any(w in msg_lower for w in ["покрыти", "зоны покрыт", "footprint", "coverage", "фут"]):
        if any(w in msg_lower for w in ["скры", "убери", "выключ", "спряч", "hide", "off", "disable"]):
            return {
                "message": "Hiding coverage zones." if en else "Скрываю зоны покрытия.",
                "actions": [{"type": "toggle_coverage", "visible": False}],
            }
        return {
            "message": (
                "Enabling coverage zone display! Each zone shows the satellite's ground footprint — "
                "the area on Earth's surface visible from the spacecraft at 0° elevation."
                if en else
                "Включаю отображение зон покрытия! Каждая зона показывает проекцию спутника "
                "на поверхность Земли — область, видимую с борта КА при угле места 0°."
            ),
            "actions": [{"type": "toggle_coverage", "visible": True}],
        }

    # ── Active links — information ────────────────────────
    if any(w in msg_lower for w in ["сколько связ", "активных связ", "количество связ", "how many link", "active link", "link count"]):
        return {
            "message": (
                "The current number of active inter-satellite links is shown in the header (ISL counter). "
                "It depends on the communication range and satellite positions. "
                "Try enabling links to see them!"
                if en else
                "Текущее количество активных межспутниковых связей отображается в шапке (счётчик МСС). "
                "Оно зависит от дальности связи и позиций спутников. "
                "Попробуй включить линии связи, чтобы увидеть их!"
            ),
            "actions": [{"type": "toggle_links", "visible": True}],
        }

    # ── Orbit altitude ────────────────────────────────────
    if any(w in msg_lower for w in ["высот", "altitude"]):
        nums = re.findall(r'\d+', msg_lower)
        if nums:
            alt = min(2000, max(0, int(nums[0])))
            if alt == 0:
                return {
                    "message": (
                        "Switching to real TLE satellite orbits."
                        if en else
                        "Переключаюсь на реальные TLE-орбиты спутников."
                    ),
                    "actions": [{"type": "set_orbit_altitude", "altitude_km": 0}],
                }
            return {
                "message": (
                    f"Setting virtual circular orbit altitude: {alt} km. "
                    "All satellites will be evenly distributed at this altitude."
                    if en else
                    f"Устанавливаю высоту виртуальной круговой орбиты: {alt} км. "
                    "Все спутники будут равномерно распределены на этой высоте."
                ),
                "actions": [{"type": "set_orbit_altitude", "altitude_km": alt}],
            }

    # ── Satellite labels ──────────────────────────────────
    if any(w in msg_lower for w in ["подпис", "метки", "label", "имена спут", "назван спут"]):
        if any(w in msg_lower for w in ["скры", "убери", "выключ", "спряч", "hide", "off", "disable"]):
            return {
                "message": "Hiding satellite labels." if en else "Скрываю подписи спутников.",
                "actions": [{"type": "toggle_labels", "visible": False}],
            }
        return {
            "message": (
                "Enabling satellite labels on the visualization."
                if en else
                "Включаю подписи спутников на визуализации."
            ),
            "actions": [{"type": "toggle_labels", "visible": True}],
        }

    # ── Show satellite by name ────────────────────────────
    if any(w in msg_lower for w in ["покаж", "найди", "где ", "фокус", "show", "find", "where", "focus"]):
        sat_map = {
            # Real satellites in our system (correct NORAD IDs)
            "декарт": 46493, "dekart": 46493,
            "норби-2": 57179, "norbi-2": 57179, "норби2": 57179,
            "норби": 46494, "norbi": 46494,
            "ярило-1": 46490, "yarilo-1": 46490, "ярило1": 46490,
            "ярило-3": 57198, "yarilo-3": 57198, "ярило3": 57198,
            "ярило": 57198, "yarilo": 57198,
            "умка": 57172, "umka": 57172, "умка-1": 57172,
            "cubesx-hse-3": 57178, "cubesx-3": 57178,
            "cubesx-hse": 47952, "cubesx": 47952,
            "геоскан": 53385, "эдельвейс": 53385, "geoscan": 53385, "edelveis": 53385,
            "монитор": 57184, "monitor": 57184,
            "самсат": 61784, "samsat": 61784, "ионосфер": 61784,
            "tusur": 61782, "тусур": 61782,
            "mirea": 61785, "мирэа": 61785,
            "горизонт": 61757, "horizont": 61757,
            "asrtu": 61781,
        }
        for name, nid in sat_map.items():
            if name in msg_lower:
                sat_info = None
                for s in RUSSIAN_CUBESATS:
                    if s.norad_id == nid:
                        sat_info = s
                        break
                sat_name = sat_info.name if sat_info else f"NORAD {nid}"
                return {
                    "message": (
                        f"Focusing camera on {sat_name}."
                        if en else
                        f"Навожу камеру на {sat_name}."
                    ),
                    "actions": [{"type": "focus_satellite", "norad_id": nid}],
                }

    # ── Reset ─────────────────────────────────────────────
    if any(w in msg_lower for w in ["сброс", "reset", "начал", "по умолч", "верн", "default"]):
        return {
            "message": (
                "Resetting all parameters to default values."
                if en else
                "Сбрасываю все параметры к начальным значениям."
            ),
            "actions": [{"type": "reset_view"}],
        }

    # ── Kepler / orbital mechanics ────────────────────────
    if any(w in msg_lower for w in ["кеплер", "механик", "физик", "гравитац", "закон", "kepler", "mechanic", "physic", "gravit", "law"]):
        return {
            "message": (
                "Orbital mechanics is based on Kepler's laws:\n"
                "1. Orbits are ellipses with the center of mass at one focus\n"
                "2. The radius vector sweeps equal areas in equal time\n"
                "3. T² ∝ a³ (period² is proportional to semi-major axis³)\n\n"
                "In StarVision we use the SGP4 model for precise satellite position calculation "
                "accounting for atmospheric drag, J2 gravitational harmonics and other perturbations."
                if en else
                "Орбитальная механика основана на законах Кеплера:\n"
                "1. Орбиты — эллипсы с центром масс в фокусе\n"
                "2. Радиус-вектор заметает равные площади за равное время\n"
                "3. T² ∝ a³ (период² пропорционален полуоси³)\n\n"
                "В StarVision мы используем модель SGP4 для точного расчёта "
                "позиций спутников с учётом атмосферного торможения, "
                "гравитационных гармоник J2 и других возмущений."
            ),
            "actions": [],
        }

    # ── Starlink / OneWeb / comparison ───────────────────
    if any(w in msg_lower for w in ["starlink", "oneweb", "сравн", "илон", "маск", "compar", "elon", "musk"]):
        return {
            "message": (
                "Comparison of major constellations:\n"
                "• Starlink (SpaceX): ~5000+ satellites, 550 km, broadband\n"
                "• OneWeb: ~600 satellites, 1200 km, broadband\n"
                "• Sfera (Russia): planned 600+ S/C, comms + IoT + EO\n"
                "• Gonets-M: ~12 satellites, 1500 km, personal comms\n\n"
                "Russian constellations focus on polar coverage "
                "and multi-purpose design (comms + IoT + observation)."
                if en else
                "Сравнение крупнейших группировок:\n"
                "• Starlink (SpaceX): ~5000+ спутников, 550 км, ШПД\n"
                "• OneWeb: ~600 спутников, 1200 км, ШПД\n"
                "• Сфера (Россия): планируется 600+ КА, связь + IoT + ДЗЗ\n"
                "• УниверСат / Space-Pi: образовательные кубсаты российских вузов\n\n"
                "В нашей модели — 15 реальных российских кубсатов на ССО ~500–550 км."
            ),
            "actions": [],
        }

    # ── TLE / SGP4 ───────────────────────────────────────
    if any(w in msg_lower for w in ["tle", "sgp4", "двухстрочн", "элемент", "two-line", "element"]):
        return {
            "message": (
                "TLE (Two-Line Elements) is a standard orbital element format including:\n"
                "• Inclination, RAAN, eccentricity\n"
                "• Argument of perigee, mean anomaly\n"
                "• Mean motion (revolutions/day)\n\n"
                "SGP4 is an analytical propagation model that accounts for "
                "J2 perturbations, atmospheric drag and other effects. "
                "We use it for real-time position calculation."
                if en else
                "TLE (Two-Line Elements) — двухстрочные элементы орбиты. "
                "Это стандартный формат описания орбиты, включающий:\n"
                "• Наклонение, RAAN, эксцентриситет\n"
                "• Аргумент перигея, средняя аномалия\n"
                "• Среднее движение (обороты/сутки)\n\n"
                "SGP4 — аналитическая модель распространения, которая учитывает "
                "возмущения J2, атмосферное торможение и другие эффекты. "
                "Мы используем её для расчёта позиций в реальном времени."
            ),
            "actions": [],
        }

    # ── CubeSat / form factor ─────────────────────────────
    if any(w in msg_lower for w in ["кубсат", "cubesat", "формфактор", "форм-фактор", "размер", "form factor", "size"]):
        return {
            "message": (
                "CubeSat — small satellite standard:\n"
                "• 1U: 10×10×10 cm, ~1.3 kg (SiriusSat)\n"
                "• 3U: 10×10×30 cm, ~4 kg (UmKA-1)\n"
                "• 6U: 10×20×30 cm, ~12 kg (Marathon-IoT)\n"
                "• 12U: 20×20×30 cm, ~24 kg (Dekart)\n\n"
                "Standardization reduces launch costs and enables "
                "use of unified deployers."
                if en else
                "CubeSat — стандарт малых спутников:\n"
                "• 1U: 10×10×10 см, ~1.3 кг (СириусСат)\n"
                "• 3U: 10×10×30 см, ~4 кг (УмКА-1)\n"
                "• 6U: 10×20×30 см, ~12 кг (Марафон-IoT)\n"
                "• 12U: 20×20×30 см, ~24 кг (Декарт)\n\n"
                "Стандартизация позволяет удешевить запуск и использовать "
                "унифицированные пусковые контейнеры."
            ),
            "actions": [],
        }

    # ── Help ──────────────────────────────────────────────
    if any(w in msg_lower for w in ["помощ", "help", "команд", "что ты умеешь", "что можешь", "возможност", "what can you", "capabilities"]):
        return {
            "message": (
                "Here's what I can do:\n"
                "✦ Tell about satellites: 'Tell me about UmKA-1', 'What is UniverSat?'\n"
                "✦ Show a satellite: 'Show Dekart', 'Where is Yarilo-3?'\n"
                "✦ Control speed: 'Speed up 50x', 'Slow down'\n"
                "✦ Control links: 'Show links', 'Set range 1000 km'\n"
                "✦ Coverage zones: 'Show coverage', 'Hide coverage'\n"
                "✦ Change orbits: 'Altitude 600 km', 'Set 10 satellites'\n"
                "✦ Explain mechanics: 'What is SGP4?', 'Kepler's laws'\n"
                "✦ Compare: 'Compare Starlink and Sfera'\n"
                "✦ Reset everything: 'Reset'"
                if en else
                "Вот что я умею:\n"
                "✦ Рассказать о спутниках: «Расскажи про УмКА-1», «Что такое УниверСат?»\n"
                "✦ Показать спутник: «Покажи Декарт», «Где Ярило-3?»\n"
                "✦ Управлять скоростью: «Ускорь в 50 раз», «Замедли»\n"
                "✦ Управлять связями: «Покажи связи», «Установи дальность 1000 км»\n"
                "✦ Зоны покрытия: «Покажи покрытие», «Скрой покрытие»\n"
                "✦ Менять орбиты: «Высота 600 км», «Установи 10 спутников»\n"
                "✦ Объяснять механику: «Что такое SGP4?», «Законы Кеплера»\n"
                "✦ Сравнивать: «Сравни Starlink и Сферу»\n"
                "✦ Сбросить всё: «Сброс»"
            ),
            "actions": [],
        }

    # ── Collisions / close approaches ────────────────────
    if any(w in msg_lower for w in ["коллизи", "столкнов", "сближен", "опасност", "collision", "close approach"]):
        return {
            "message": (
                "Collision prediction is an important constellation management task. "
                "StarVision analyzes all satellite trajectories 24 hours ahead "
                "and identifies potential close approaches (threshold: 100 km).\n\n"
                "Main prevention methods:\n"
                "• NORAD / 18th Space Defense Squadron catalog monitoring\n"
                "• Avoidance maneuvers at P(collision) > 10⁻⁴\n"
                "• Walker distribution minimizes risk within the constellation\n\n"
                "Use API: /api/collisions for predictions."
                if en else
                "Прогнозирование коллизий — важная задача управления группировкой. "
                "StarVision анализирует траектории всех спутников на 24 часа вперёд "
                "и выявляет потенциальные сближения (порог: 100 км).\n\n"
                "Основные методы предотвращения:\n"
                "• Мониторинг каталога NORAD / 18-й эскадрильи ВКС США\n"
                "• Манёвры уклонения при P(collision) > 10⁻⁴\n"
                "• Walker-распределение минимизирует риск внутри группировки\n\n"
                "Используйте API: /api/collisions для получения прогноза."
            ),
            "actions": [],
        }

    # ── Plane optimization ────────────────────────────────
    if any(w in msg_lower for w in ["оптимиз", "walker", "распредел", "плоскост", "optimiz", "plane", "distribut"]):
        nums = re.findall(r'\d+', msg_lower)
        if nums:
            planes = min(7, max(1, int(nums[0])))
            return {
                "message": (
                    f"Setting {planes} orbital plane{'s' if planes != 1 else ''}. "
                    "Satellites will be distributed evenly across these planes "
                    "using the Walker-δ pattern."
                    if en else
                    f"Устанавливаю {planes} орбитальн{'ых плоскостей' if planes > 4 else 'ые плоскости' if planes > 1 else 'ую плоскость'}. "
                    "Спутники будут равномерно распределены по плоскостям "
                    "по схеме Walker-δ."
                ),
                "actions": [{"type": "set_orbital_planes", "planes": planes}],
            }
        return {
            "message": (
                "Orbital plane distribution optimization uses "
                "the Walker-δ constellation model (T/P/F):\n\n"
                "• T — total number of satellites\n"
                "• P — number of orbital planes\n"
                "• F — phase factor (inter-plane shift)\n\n"
                "Optimal distribution provides:\n"
                "✦ Maximum Earth surface coverage\n"
                "✦ Minimum communication gaps\n"
                "✦ Uniform ISL channel load\n\n"
                "Use the 'Orbital planes' slider in the control panel "
                "or tell me, e.g.: 'Set 5 planes'."
                if en else
                "Оптимизация распределения по орбитальным плоскостям использует "
                "модель Walker-δ constellation (T/P/F):\n\n"
                "• T — общее число спутников\n"
                "• P — число орбитальных плоскостей\n"
                "• F — фазовый фактор (межплоскостный сдвиг)\n\n"
                "Оптимальное распределение обеспечивает:\n"
                "✦ Максимальное покрытие поверхности Земли\n"
                "✦ Минимальные перерывы в связи\n"
                "✦ Равномерную нагрузку на каналы ISL\n\n"
                "Используйте ползунок «Орбитальные плоскости» в панели управления "
                "или скажите мне, например: «Установи 5 плоскостей»."
            ),
            "actions": [],
        }

    # ── Space / general questions ─────────────────────────
    if any(w in msg_lower for w in ["космос", "мкс", "ракет", "запуск", "space", "iss", "rocket", "launch"]):
        return {
            "message": (
                "Small satellite launches are typically carried out as secondary payloads "
                "on Soyuz-2, Falcon 9, or specialized cubesat launchers. "
                "From the ISS, satellites are deployed through the Kibo module (JAXA) airlock. "
                "Russia is also developing the Sputnix platform "
                "for serial small spacecraft production."
                if en else
                "Космические запуски малых спутников обычно осуществляются как попутная "
                "нагрузка на ракетах-носителях «Союз-2», Falcon 9 или специализированных "
                "носителях для кубсатов. С МКС спутники выводятся через шлюзовую камеру "
                "модуля Kibo (JAXA). Россия также развивает платформу «Спутникс» "
                "для серийного производства малых КА."
            ),
            "actions": [],
        }

    # ── Thanks ────────────────────────────────────────────
    if any(w in msg_lower for w in ["спасибо", "благодар", "круто", "класс", "отлично", "thanks", "thank you", "great", "awesome"]):
        return {
            "message": (
                "Glad to help! ✦ If you have more questions about satellites or visualization — "
                "just ask. I'm always online!"
                if en else
                "Рад помочь! ✦ Если есть ещё вопросы о спутниках или визуализации — "
                "спрашивай. Я всегда на связи!"
            ),
            "actions": [],
        }

    # ── Show everything / enable all ─────────────────────
    if any(w in msg_lower for w in ["покажи всё", "покажи все", "включи всё", "включи все", "show all", "enable all", "show everything"]):
        return {
            "message": (
                "Enabling all visualizations: orbits, links, coverage zones and labels!"
                if en else
                "Включаю все визуализации: орбиты, связи, зоны покрытия и подписи!"
            ),
            "actions": [
                {"type": "toggle_orbits", "visible": True},
                {"type": "toggle_links", "visible": True},
                {"type": "toggle_coverage", "visible": True},
                {"type": "toggle_labels", "visible": True},
            ],
        }

    # ── General response ──────────────────────────────────
    return {
        "message": (
            "I am StarAI — StarVision's intelligent assistant. Here's what I can do:\n"
            "✦ Tell about satellites: 'Tell me about UmKA-1'\n"
            "✦ Show a satellite: 'Show Dekart', 'Where is Yarilo-3?'\n"
            "✦ Control speed: 'Speed up 50x', 'Slow down'\n"
            "✦ Control links and coverage: 'Show links', 'Show coverage'\n"
            "✦ Change orbits: 'Altitude 600 km', 'Set 10 satellites'\n"
            "✦ Explain mechanics: 'What is SGP4?', 'Kepler's laws'\n\n"
            "Try asking me something!"
            if en else
            "Я StarAI — интеллектуальный ассистент StarVision. Вот что я могу:\n"
            "✦ Рассказать о спутниках: «Расскажи про УмКА-1»\n"
            "✦ Показать спутник: «Покажи Декарт», «Где Ярило-3?»\n"
            "✦ Управлять скоростью: «Ускорь в 50 раз», «Замедли»\n"
            "✦ Управлять связями и покрытием: «Покажи связи», «Покажи покрытие»\n"
            "✦ Менять орбиты: «Высота 600 км», «Установи 10 спутников»\n"
            "✦ Объяснить механику: «Что такое SGP4?», «Законы Кеплера»\n\n"
            "Попробуй спросить меня о чём-нибудь!"
        ),
        "actions": [],
    }
