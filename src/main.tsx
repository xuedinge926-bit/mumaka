import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
// Production builds retain the application shell for local offline use.
// IndexedDB, not the service-worker cache, stores user records.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      console.warn('离线页面缓存不可用；已打开的页面与 IndexedDB 仍可使用。');
    });
  });
}
