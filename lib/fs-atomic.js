/**
 * 原子写：整文件写入走临时文件再改名，写到一半断电也不会留下半截页。
 * 追加写（log）不需要这个，追加失败最多多一行。
 */
import { writeFileSync, renameSync, unlinkSync } from 'node:fs'

export function writeAtomic(file, data) {
  const tmp = `${file}.tmp-${process.pid}`
  try {
    writeFileSync(tmp, data, 'utf8')
    renameSync(tmp, file)
  } catch (error) {
    try {
      unlinkSync(tmp)
    } catch {
      /* 临时文件可能压根没建出来 */
    }
    throw error
  }
}
