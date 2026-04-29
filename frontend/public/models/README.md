# Optional glTF CubeSat model

The renderer ships with a procedural Three.js CubeSat (body, deployable
solar panels with metallic frames, antennas, lens) — full PBR materials
with real surface normals, suitable for the bloom pass. To swap in a
high-fidelity asset (NASA 3D Resources, GrabCAD, Sketchfab CC-licensed
exports, etc.):

1. Export the model as `.glb` (binary glTF 2.0). Recommended sources:
   - https://nasa3d.arc.nasa.gov/models  (CC0 / public domain)
   - https://grabcad.com/library?query=cubesat  (check each model's licence)
2. Drop the file in this folder, e.g. `frontend/public/models/cubesat.glb`.
3. Set the env var before building the frontend:

   ```bash
   echo "VITE_CUBESAT_GLB=/models/cubesat.glb" >> frontend/.env.local
   ```

   For the Docker build pass it as a build arg:

   ```bash
   docker compose build --build-arg VITE_API_BASE=/api \
     frontend
   # or, for the glTF specifically:
   docker build -t starvision-frontend ./frontend \
     --build-arg VITE_API_BASE=/api \
     --build-arg VITE_CUBESAT_GLB=/models/cubesat.glb
   ```

When `VITE_CUBESAT_GLB` is unset the frontend never references the file,
so there is no 404 in dev or production.
