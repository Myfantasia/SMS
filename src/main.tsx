import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// React will look for a div with id="react-root" in your Django template
const rootElement = document.getElementById('react-root');

if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
} else {
  console.log("React root element not found on this page.");
}