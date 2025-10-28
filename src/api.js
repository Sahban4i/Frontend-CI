const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:5000/api");

const withAuth = (init = {}) => {
  const token = localStorage.getItem("token");
  return {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  };
};

async function request(path, init) {
  const res = await fetch(`${API_URL}${path}`, init);
  if (res.status === 401) {
    localStorage.removeItem("token");
  }
  return res;
}

export const authAPI = {
  register: async (email, password) => (await request(`/auth/register`, withAuth({ method: "POST", body: JSON.stringify({ email, password }) }))).json(),
  login: async (email, password) => (await request(`/auth/login`, withAuth({ method: "POST", body: JSON.stringify({ email, password }) }))).json(),
};

export const summaryAPI = {
  getAll: async (params = {}) => {
    const qs = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "")
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
    const res = await request(`/summaries${qs ? `?${qs}` : ""}`, { method: "GET" });
    return res.json();
  },
  save: async (note, summary, tags = []) => (await request(`/summaries`, withAuth({ method: "POST", body: JSON.stringify({ note, summary, tags }) }))).json(),
  update: async (id, note, summary, tags = [], starred) => (await request(`/summaries/${id}`, withAuth({ method: "PUT", body: JSON.stringify({ note, summary, tags, starred }) }))).json(),
  delete: async (id) => (await request(`/summaries/${id}`, withAuth({ method: "DELETE" }))).json(),
  star: async (id, starred) => (await request(`/summaries/${id}/star`, withAuth({ method: "PATCH", body: JSON.stringify({ starred }) }))).json(),
  share: async (id) => (await request(`/summaries/${id}/share`, withAuth({ method: "POST" }))).json(),
};