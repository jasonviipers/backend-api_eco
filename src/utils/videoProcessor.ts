import ffmpeg from "fluent-ffmpeg"
import ffmpegStatic from "ffmpeg-static"
import path from "node:path"
import fs from "node:fs/promises"
import { cloudinary } from "../config/cloudinary"
import { logger } from "./logger"

// Set ffmpeg path
ffmpeg.setFfmpegPath(ffmpegStatic!)

export interface VideoFormat {
  quality: string
  resolution: string
  bitrate: string
  url: string
  size: number
  codec: string
}

export interface VideoThumbnail {
  url: string
  timestamp: number
  width: number
  height: number
  size: number
}

export interface ProcessedVideo {
  duration: number
  originalSize: number
  thumbnails: VideoThumbnail[]
  formats: VideoFormat[]
  metadata: {
    width: number
    height: number
    fps: number
    codec: string
    bitrate: string
  }
  processingTime: number
}

export interface ProcessingOptions {
  generateThumbnails?: boolean
  thumbnailCount?: number
  formats?: string[]
  maxDuration?: number
  watermark?: {
    text?: string
    image?: string
    position?: "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center"
  }
}

const DEFAULT_FORMATS = [
  {
    quality: "240p",
    resolution: "426x240",
    bitrate: "400k",
    codec: "libx264",
  },
  {
    quality: "360p",
    resolution: "640x360",
    bitrate: "800k",
    codec: "libx264",
  },
  {
    quality: "480p",
    resolution: "854x480",
    bitrate: "1200k",
    codec: "libx264",
  },
  {
    quality: "720p",
    resolution: "1280x720",
    bitrate: "2500k",
    codec: "libx264",
  },
  {
    quality: "1080p",
    resolution: "1920x1080",
    bitrate: "5000k",
    codec: "libx264",
  },
]

// Helper function to safely parse frame rate
const parseFrameRate = (frameRate: string | undefined): number => {
  if (!frameRate) return 0
  
  try {
    // Handle fraction format like "30/1" or "29.97"
    if (frameRate.includes('/')) {
      const [numerator, denominator] = frameRate.split('/').map(Number)
      return denominator !== 0 ? numerator / denominator : 0
    }
    
    return parseFloat(frameRate) || 0
  } catch (error) {
    logger.warn(`Failed to parse frame rate: ${frameRate}`, error)
    return 0
  }
}

export const processVideo = async (videoUrl: string, options: ProcessingOptions = {}): Promise<ProcessedVideo> => {
  const startTime = Date.now()
  const tempDir = `/tmp/video_processing_${Date.now()}`

  try {
    // Create temporary directory
    await fs.mkdir(tempDir, { recursive: true })

    // Download video to temp directory
    const inputPath = path.join(tempDir, "input.mp4")
    await downloadVideo(videoUrl, inputPath)

    // Get video metadata
    const metadata = await getVideoMetadata(inputPath)
    logger.info("Video metadata extracted:", metadata)

    // Validate video duration
    if (options.maxDuration && metadata.duration > options.maxDuration) {
      throw new Error(`Video duration (${metadata.duration}s) exceeds maximum allowed (${options.maxDuration}s)`)
    }

    // Get original file size
    const stats = await fs.stat(inputPath)
    const originalSize = stats.size

    // Process video formats
    const formats = await processVideoFormats(inputPath, tempDir, metadata, options)

    // Generate thumbnails
    const thumbnails =
      options.generateThumbnails !== false
        ? await generateThumbnails(inputPath, tempDir, metadata, options.thumbnailCount || 5)
        : []

    const processingTime = Date.now() - startTime

    logger.info(`Video processing completed in ${processingTime}ms`)

    return {
      duration: metadata.duration,
      originalSize,
      thumbnails,
      formats,
      metadata: {
        width: metadata.width,
        height: metadata.height,
        fps: metadata.fps,
        codec: metadata.codec,
        bitrate: metadata.bitrate,
      },
      processingTime,
    }
  } catch (error) {
    logger.error("Video processing failed:", error)
    throw error
  } finally {
    // Cleanup temporary files
    try {
      await fs.rm(tempDir, { recursive: true, force: true })
    } catch (cleanupError) {
      logger.warn("Failed to cleanup temp directory:", cleanupError)
    }
  }
}

const downloadVideo = async (url: string, outputPath: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    ffmpeg(url)
      .output(outputPath)
      .on("end", () => resolve())
      .on("error", reject)
      .run()
  })
}

const getVideoMetadata = async (inputPath: string): Promise<any> => {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(inputPath, (err, metadata) => {
      if (err) {
        reject(err)
        return
      }

      const videoStream = metadata.streams.find((stream) => stream.codec_type === "video")
      if (!videoStream) {
        reject(new Error("No video stream found"))
        return
      }

      resolve({
        duration: metadata.format.duration || 0,
        width: videoStream.width || 0,
        height: videoStream.height || 0,
        fps: parseFrameRate(videoStream.r_frame_rate),
        codec: videoStream.codec_name || "unknown",
        bitrate: metadata.format.bit_rate || "0",
      })
    })
  })
}

const processVideoFormats = async (
  inputPath: string,
  tempDir: string,
  metadata: any,
  options: ProcessingOptions,
): Promise<VideoFormat[]> => {
  const formats: VideoFormat[] = []
  const requestedFormats = options.formats || ["360p", "720p"]

  // Filter formats based on original resolution
  const availableFormats = DEFAULT_FORMATS.filter((format) => {
    const [width, height] = format.resolution.split("x").map(Number)
    return height <= metadata.height && requestedFormats.includes(format.quality)
  })

  // Always include original quality if not in list
  if (!availableFormats.find((f) => f.quality === getQualityFromResolution(metadata.width, metadata.height))) {
    availableFormats.push({
      quality: "original",
      resolution: `${metadata.width}x${metadata.height}`,
      bitrate: metadata.bitrate,
      codec: "libx264",
    })
  }

  for (const format of availableFormats) {
    try {
      const outputPath = path.join(tempDir, `output_${format.quality}.mp4`)

      await processVideoFormat(inputPath, outputPath, format, options)

      // Upload to Cloudinary
      const uploadResult = await uploadToCloudinary(outputPath, `video_${format.quality}`)

      // Get file size
      const stats = await fs.stat(outputPath)

      formats.push({
        quality: format.quality,
        resolution: format.resolution,
        bitrate: format.bitrate,
        url: uploadResult.secure_url,
        size: stats.size,
        codec: format.codec,
      })

      logger.info(`Processed format ${format.quality}: ${uploadResult.secure_url}`)
    } catch (error) {
      logger.error(`Failed to process format ${format.quality}:`, error)
      // Continue with other formats
    }
  }

  return formats
}

const processVideoFormat = async (
  inputPath: string,
  outputPath: string,
  format: any,
  options: ProcessingOptions,
): Promise<void> => {
  return new Promise((resolve, reject) => {
    let command = ffmpeg(inputPath)
      .videoCodec(format.codec)
      .videoBitrate(format.bitrate)
      .size(format.resolution)
      .audioCodec("aac")
      .audioBitrate("128k")
      .format("mp4")
      .outputOptions([
        "-preset fast",
        "-crf 23",
        "-movflags +faststart", // Enable progressive download
        "-pix_fmt yuv420p", // Ensure compatibility
      ])

    // Add watermark if specified
    if (options.watermark) {
      command = addWatermark(command, options.watermark)
    }

    command
      .output(outputPath)
      .on("start", (commandLine) => {
        logger.info(`FFmpeg command: ${commandLine}`)
      })
      .on("progress", (progress) => {
        logger.debug(`Processing ${format.quality}: ${progress.percent}% done`)
      })
      .on("end", () => {
        logger.info(`Format ${format.quality} processed successfully`)
        resolve()
      })
      .on("error", (err) => {
        logger.error(`Error processing format ${format.quality}:`, err)
        reject(err)
      })
      .run()
  })
}

const generateThumbnails = async (
  inputPath: string,
  tempDir: string,
  metadata: any,
  count: number,
): Promise<VideoThumbnail[]> => {
  const thumbnails: VideoThumbnail[] = []
  const duration = metadata.duration

  // Generate thumbnails at different timestamps
  const timestamps = []
  for (let i = 0; i < count; i++) {
    const timestamp = (duration / (count + 1)) * (i + 1)
    timestamps.push(timestamp)
  }

  for (let i = 0; i < timestamps.length; i++) {
    try {
      const timestamp = timestamps[i]
      const thumbnailPath = path.join(tempDir, `thumbnail_${i}.jpg`)

      await generateSingleThumbnail(inputPath, thumbnailPath, timestamp)

      // Upload to Cloudinary
      const uploadResult = await uploadToCloudinary(thumbnailPath, `thumbnail_${i}`)

      // Get file size
      const stats = await fs.stat(thumbnailPath)

      thumbnails.push({
        url: uploadResult.secure_url,
        timestamp,
        width: 320,
        height: 180,
        size: stats.size,
      })

      logger.info(`Generated thumbnail ${i + 1}/${count}: ${uploadResult.secure_url}`)
    } catch (error) {
      logger.error(`Failed to generate thumbnail ${i}:`, error)
      // Continue with other thumbnails
    }
  }

  return thumbnails
}

const generateSingleThumbnail = async (inputPath: string, outputPath: string, timestamp: number): Promise<void> => {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .seekInput(timestamp)
      .frames(1)
      .size("320x180")
      .format("image2")
      .outputOptions([
        "-q:v 2", // High quality
        "-vf scale=320:180:force_original_aspect_ratio=decrease,pad=320:180:(ow-iw)/2:(oh-ih)/2",
      ])
      .output(outputPath)
      .on("end", () => resolve())
      .on("error", reject)
      .run()
  })
}

const addWatermark = (command: any, watermark: any): any => {
  if (watermark.text) {
    // Text watermark
    const position = getWatermarkPosition(watermark.position || "bottom-right")
    command = command.outputOptions([
      `-vf drawtext=text='${watermark.text}':fontcolor=white:fontsize=24:x=${position.x}:y=${position.y}`,
    ])
  } else if (watermark.image) {
    // Image watermark
    const position = getWatermarkPosition(watermark.position || "bottom-right")
    command = command.outputOptions([`-vf overlay=${position.x}:${position.y}`])
  }

  return command
}

const getWatermarkPosition = (position: string): { x: string; y: string } => {
  switch (position) {
    case "top-left":
      return { x: "10", y: "10" }
    case "top-right":
      return { x: "W-w-10", y: "10" }
    case "bottom-left":
      return { x: "10", y: "H-h-10" }
    case "bottom-right":
      return { x: "W-w-10", y: "H-h-10" }
    case "center":
      return { x: "(W-w)/2", y: "(H-h)/2" }
    default:
      return { x: "W-w-10", y: "H-h-10" }
  }
}

const uploadToCloudinary = async (filePath: string, publicId: string): Promise<any> => {
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload(
      filePath,
      {
        resource_type: "auto",
        folder: "processed_videos",
        public_id: publicId,
        overwrite: true,
      },
      (error, result) => {
        if (error) reject(error)
        else resolve(result)
      },
    )
  })
}

const getQualityFromResolution = (width: number, height: number): string => {
  if (height >= 1080) return "1080p"
  if (height >= 720) return "720p"
  if (height >= 480) return "480p"
  if (height >= 360) return "360p"
  return "240p"
}

// Advanced video processing functions

export const createVideoPreview = async (videoUrl: string, duration = 30): Promise<string> => {
  const tempDir = `/tmp/preview_${Date.now()}`

  try {
    await fs.mkdir(tempDir, { recursive: true })

    const inputPath = path.join(tempDir, "input.mp4")
    const outputPath = path.join(tempDir, "preview.mp4")

    // Download original video
    await downloadVideo(videoUrl, inputPath)

    // Create preview (first 30 seconds)
    await new Promise<void>((resolve, reject) => {
      ffmpeg(inputPath)
        .duration(duration)
        .videoCodec("libx264")
        .audioCodec("aac")
        .size("640x360")
        .outputOptions(["-preset fast", "-crf 28"])
        .output(outputPath)
        .on("end", () => resolve())
        .on("error", reject)
        .run()
    })

    // Upload preview
    const uploadResult = await uploadToCloudinary(outputPath, "video_preview")

    return uploadResult.secure_url
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true })
  }
}

export const extractAudioFromVideo = async (videoUrl: string): Promise<string> => {
  const tempDir = `/tmp/audio_${Date.now()}`

  try {
    await fs.mkdir(tempDir, { recursive: true })

    const inputPath = path.join(tempDir, "input.mp4")
    const outputPath = path.join(tempDir, "audio.mp3")

    // Download original video
    await downloadVideo(videoUrl, inputPath)

    // Extract audio
    await new Promise<void>((resolve, reject) => {
      ffmpeg(inputPath)
        .noVideo()
        .audioCodec("mp3")
        .audioBitrate("128k")
        .output(outputPath)
        .on("end", () => resolve())
        .on("error", reject)
        .run()
    })

    // Upload audio
    const uploadResult = await uploadToCloudinary(outputPath, "extracted_audio")

    return uploadResult.secure_url
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true })
  }
}

export const generateVideoGif = async (videoUrl: string, startTime = 0, duration = 3): Promise<string> => {
  const tempDir = `/tmp/gif_${Date.now()}`

  try {
    await fs.mkdir(tempDir, { recursive: true })

    const inputPath = path.join(tempDir, "input.mp4")
    const outputPath = path.join(tempDir, "output.gif")

    // Download original video
    await downloadVideo(videoUrl, inputPath)

    // Generate GIF
    await new Promise<void>((resolve, reject) => {
      ffmpeg(inputPath)
        .seekInput(startTime)
        .duration(duration)
        .size("320x180")
        .fps(10)
        .outputOptions(["-vf scale=320:180:flags=lanczos,palettegen=reserve_transparent=0", "-f gif"])
        .output(outputPath)
        .on("end", () => resolve())
        .on("error", reject)
        .run()
    })

    // Upload GIF
    const uploadResult = await uploadToCloudinary(outputPath, "video_gif")

    return uploadResult.secure_url
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true })
  }
}

// Batch processing for multiple videos
export const batchProcessVideos = async (
  videoUrls: string[],
  options: ProcessingOptions = {},
): Promise<ProcessedVideo[]> => {
  const results: ProcessedVideo[] = []
  const concurrency = 3 // Process 3 videos at a time

  for (let i = 0; i < videoUrls.length; i += concurrency) {
    const batch = videoUrls.slice(i, i + concurrency)

    const batchPromises = batch.map(async (url, index) => {
      try {
        logger.info(`Processing video ${i + index + 1}/${videoUrls.length}: ${url}`)
        return await processVideo(url, options)
      } catch (error) {
        logger.error(`Failed to process video ${i + index + 1}:`, error)
        throw error
      }
    })

    const batchResults = await Promise.allSettled(batchPromises)

    batchResults.forEach((result, index) => {
      if (result.status === "fulfilled") {
        results.push(result.value)
      } else {
        logger.error(`Video ${i + index + 1} processing failed:`, result.reason)
      }
    })
  }

  return results
}

// Video quality analysis
export const analyzeVideoQuality = async (videoUrl: string): Promise<any> => {
  const tempDir = `/tmp/analysis_${Date.now()}`

  try {
    await fs.mkdir(tempDir, { recursive: true })

    const inputPath = path.join(tempDir, "input.mp4")
    await downloadVideo(videoUrl, inputPath)

    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(
        inputPath,
        ["-show_streams", "-show_format", "-v", "quiet", "-print_format", "json"],
        (err, data) => {
          if (err) {
            reject(err)
            return
          }

          const videoStream = data.streams.find((stream: any) => stream.codec_type === "video")
          const audioStream = data.streams.find((stream: any) => stream.codec_type === "audio")

          resolve({
            format: data.format,
            video: videoStream,
            audio: audioStream,
            quality: {
              resolution: videoStream ? `${videoStream.width}x${videoStream.height}` : "unknown",
              bitrate: data.format.bit_rate,
              duration: data.format.duration,
              fps: videoStream ? parseFrameRate(videoStream.r_frame_rate) : 0,
              codec: videoStream ? videoStream.codec_name : "unknown",
            },
          })
        },
      )
    })
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true })
  }
}