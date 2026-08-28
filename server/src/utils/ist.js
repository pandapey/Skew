// server/src/utils/ist.js - single source of IST
export const IST = 'Asia/Kolkata'
export const todayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: IST }) // YYYY-MM-DD IST
export const nowHMSIST = () => new Date().toLocaleTimeString('en-GB', { timeZone: IST, hour12: false }) // HH:mm:ss IST
export const nowMinsIST = () => { const [h,m]=nowHMSIST().split(':').map(Number); return h*60+m }
export const isoIST = (d) => new Date(d).toLocaleDateString('en-CA', { timeZone: IST })
export const toTimeIST = (d) => new Date(d).toLocaleTimeString('en-GB', { timeZone: IST, hour12: false })
