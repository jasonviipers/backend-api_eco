import { Hono } from 'hono'
import auth from '../routes/auth.routes'
import { userRouter } from '../routes/user.routes'
import { productRouter } from '../routes/products.routes'
import streamRouter from '../routes/stream.routes'
import { paymentRouter } from '../routes/payment.routes'
import { videoRoutes } from '../routes/video.routes'
import { vendorRouter } from '../routes/vendor.routes'

export function registerRoutes(app: Hono) {
  app.get('/health', c => {
    return c.json({
      status: 'OK',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV ?? 'development',
    })
  })
  app.route('/auth', auth)
  app.route('/user', userRouter)
  app.route('/product', productRouter)
  app.route('/stream', streamRouter)
  app.route('/payment', paymentRouter)
  app.route('/video', videoRoutes)
  app.route('/vendor', vendorRouter)
}