import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Fade out the inline splash once React has rendered the first frame.
// `requestAnimationFrame` waits one paint after mount, so the user sees
// the splash → 3D scene transition without a flash of empty canvas.
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    const splash = document.getElementById('sv-splash');
    if (!splash) return;
    splash.classList.add('hide');
    splash.addEventListener('transitionend', () => splash.remove(), { once: true });
  });
});
