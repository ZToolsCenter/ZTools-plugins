export function debounce(func: Function, delay: number) {
  let timer = null
  return function () {
    clearTimeout(timer)
    timer = setTimeout(() => {
      func.apply(this, arguments)
    }, delay)
  }
}
