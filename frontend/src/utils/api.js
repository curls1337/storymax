import axios from 'axios';

// Detect if we are in development (Vite runs on port 5173, backend on 5000)
const API_BASE_URL = window.location.port === '5033' 
  ? 'http://localhost:5022/api' 
  : '/api';

const api = axios.create({
  baseURL: API_BASE_URL,
});

// Request interceptor to add Authorization token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers['Authorization'] = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

export default api;
