/** 本地日期，`YYYY-MM-DD`。写日志和页头都用它，别再各处 re-invent。 */
export function today() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
