import ffmpeg from "fluent-ffmpeg"
import ffmpegStatic from "ffmpeg-static"
import { logger } from "./logger"

// Set ffmpeg path
ffmpeg.setFfmpegPath(ffmpegStatic!)

export interface ProcessedVideo {
  duration: number
  thumbnails: string[]
  formats: {
    quality: string
    url: string
    size: number
  }[]
}

export const processVideo = async (videoUrl: string): Promise<ProcessedVideo> => {
  return new Promise((resolve, reject) => {
    try {
      const result: ProcessedVideo = {
        duration: 0,
        thumbnails: [],
        formats: [],
      }

      ffmpeg(videoUrl).ffprobe((err, metadata) => {
        if (err) {
          logger.error("FFprobe error:", err)
          reject(err)
          return
        }

        result.duration = metadata.format.duration || 0

        // For now, return basic info
        // In production, you'd process multiple formats and thumbnails
        resolve(result)
      })
    } catch (error) {
      logger.error("Video processing error:", error)
      reject(error)
    }
  })
}

export const generateThumbnail = async (videoUrl: string, timestamp = 1): Promise<string> => {
  return new Promise((resolve, reject) => {
    const outputPath = `/tmp/thumbnail_${Date.now()}.jpg`

    ffmpeg(videoUrl)
      .seekInput(timestamp)
      .frames(1)
      .output(outputPath)
      .on("end", () => {
        resolve(outputPath)
      })
      .on("error", (err) => {
        logger.error("Thumbnail generation error:", err)
        reject(err)
      })
      .run()
  })
}
