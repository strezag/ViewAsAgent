import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { applyCachedFontStep } from '@/lib/settings';
import './style.css';

// Before the first paint. chrome.storage is async, so reading the size from
// there would render at the default and then jump; localStorage is synchronous.
applyCachedFontStep(document.documentElement);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
