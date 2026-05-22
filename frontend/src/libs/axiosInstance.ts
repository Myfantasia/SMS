import axios from 'axios';

const api = axios.create({
  baseURL: 'http://localhost:8000', // Points to your Django backend
  withCredentials: true,            // This is the magic key for Django Auth!

  xsrfCookieName: 'csrftoken',      // The name of the cookie Django sets
  xsrfHeaderName: 'X-CSRFToken',
});

export default api;