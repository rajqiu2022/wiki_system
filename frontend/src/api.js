import axios from 'axios'

const api = axios.create({ baseURL: '/api' })

// 请求拦截器：自动附加 Authorization header
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('wiki_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// 响应拦截器：401 时清除 token 并跳转登录
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('wiki_token')
      localStorage.removeItem('wiki_user')
      // 如果不在登录页则刷新
      if (!window.location.pathname.includes('/login')) {
        window.location.href = '/login'
      }
    }
    return Promise.reject(err)
  }
)

// ---- Auth ----
export const login = (data) => api.post('/users/login', data).then(r => r.data)
export const getMe = () => api.get('/users/me').then(r => r.data)

// ---- Users ----
export const getUsers = () => api.get('/users/all').then(r => r.data)
export const getUsersPaged = (params) => api.get('/users', { params }).then(r => r.data)
export const createUser = (data) => api.post('/users', data).then(r => r.data)
export const deleteUser = (id) => api.delete(`/users/${id}`).then(r => r.data)

// ---- Documents ----
// 适配新字段：name, path, description, author, create_time, status, current_editor, content
export const getDocs = (params) => api.get('/docs', { params }).then(r => r.data)
export const getDoc = (id) => api.get(`/docs/${id}`).then(r => r.data)
export const createDoc = (data) => api.post('/docs', data).then(r => r.data)
export const updateDoc = (id, data, userId) => api.put(`/docs/${id}`, data, { params: { user_id: userId } }).then(r => r.data)
export const deleteDoc = (id) => api.delete(`/docs/${id}`).then(r => r.data)
export const lockDoc = (id, userId) => api.post(`/docs/${id}/lock`, null, { params: { user_id: userId } }).then(r => r.data)
export const unlockDoc = (id, userId, force = false) => api.post(`/docs/${id}/unlock`, null, { params: { user_id: userId, force } }).then(r => r.data)
export const updateDocContent = (id, data) => api.put(`/docs/${id}/content`, data).then(r => r.data)

// ---- Uploads ----
export const uploadImage = (file) => {
  const formData = new FormData()
  formData.append('file', file)
  return api.post('/uploads/image', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }).then(r => r.data)
}

// ---- Nav ----
// 适配新字段：name, parent_path, mark, status
export const getNavTree = () => api.get('/nav/tree').then(r => r.data)
export const getNavList = () => api.get('/nav').then(r => r.data)
export const createNavNode = (data) => api.post('/nav', data).then(r => r.data)
export const updateNavNode = (id, data) => api.put(`/nav/${id}`, data).then(r => r.data)
export const deleteNavNode = (id) => api.delete(`/nav/${id}`).then(r => r.data)
export const batchUpdateNav = (nodes) => api.put('/nav/tree/batch', { nodes }).then(r => r.data)
export const reorderNav = (tree) => api.put('/nav/tree/reorder', { tree }).then(r => r.data)

// ---- Publish ----
export const publish = (userId, force = false) => api.post('/publish', null, { params: { user_id: userId, force } }).then(r => r.data)
export const getPublishLogs = () => api.get('/publish/logs').then(r => r.data)

export default api
