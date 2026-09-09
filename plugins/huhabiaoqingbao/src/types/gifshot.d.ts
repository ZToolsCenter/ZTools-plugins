declare module 'gifshot' {
  interface GifshotOptions {
    images: string[]
    gifWidth?: number
    gifHeight?: number
    interval?: number
    numFrames?: number
    loop?: number
    progressCallback?: (progress: number) => void
  }

  interface GifshotResult {
    error: any
    image: string
  }

  interface Gifshot {
    createGIF(
      options: GifshotOptions,
      callback: (result: GifshotResult) => void
    ): void
  }

  const gifshot: Gifshot
  export default gifshot
} 