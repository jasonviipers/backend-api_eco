import { emailConfig } from "../email";

export const welcomeEmailWithOTP = (
	user: { name: string; email: string },
	verificationOTP: string,
) => ({
	to: user.email,
	subject: `Welcome to ${emailConfig.appName} - Verify Your Email`,
	html: `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Welcome to ${emailConfig.appName}</title>
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        
        body { 
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
          line-height: 1.6; 
          color: #374151;
          background-color: #f8fafc;
          padding: 20px 0;
        }
        
        .email-wrapper {
          background-color: #f8fafc;
          padding: 40px 20px;
        }
        
        .container { 
          max-width: 600px; 
          margin: 0 auto; 
          background-color: #ffffff;
          border-radius: 16px;
          box-shadow: 0 10px 25px rgba(0, 0, 0, 0.1);
          overflow: hidden;
        }
        
        .header { 
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          padding: 40px 30px; 
          text-align: center; 
          color: white;
        }
        
        .header h1 {
          font-size: 28px;
          font-weight: 700;
          margin-bottom: 8px;
          letter-spacing: -0.5px;
        }
        
        .header p {
          font-size: 16px;
          opacity: 0.9;
          font-weight: 400;
        }
        
        .content { 
          padding: 40px 30px;
        }
        
        .greeting {
          font-size: 18px;
          margin-bottom: 20px;
          color: #1f2937;
        }
        
        .welcome-message {
          font-size: 16px;
          margin-bottom: 30px;
          color: #4b5563;
        }
        
        .otp-section {
          text-align: center;
          margin: 35px 0;
        }
        
        .otp-label {
          font-size: 14px;
          color: #6b7280;
          margin-bottom: 15px;
          font-weight: 500;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        
        .otp-container { 
          background: linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%);
          padding: 25px; 
          border-radius: 12px;
          border: 2px solid #e5e7eb;
          display: inline-block;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
        }
        
        .otp-code { 
          font-size: 36px; 
          font-weight: 800; 
          color: #667eea; 
          letter-spacing: 12px;
          font-family: 'Courier New', Consolas, monospace;
          text-shadow: 0 2px 4px rgba(102, 126, 234, 0.2);
        }
        
        .security-info {
          background-color: #fef3cd;
          border: 1px solid #fde68a;
          border-radius: 8px;
          padding: 20px;
          margin: 30px 0;
        }
        
        .security-info .icon {
          display: inline-block;
          width: 20px;
          height: 20px;
          background-color: #f59e0b;
          border-radius: 50%;
          margin-right: 10px;
          vertical-align: middle;
          position: relative;
        }
        
        .security-info .icon::after {
          content: "!";
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          color: white;
          font-weight: bold;
          font-size: 12px;
        }
        
        .security-info p {
          margin: 0;
          font-size: 14px;
          color: #92400e;
          display: inline-block;
          vertical-align: middle;
          width: calc(100% - 35px);
        }
        
        .help-section {
          background-color: #f0f9ff;
          border-radius: 8px;
          padding: 20px;
          margin: 30px 0;
          text-align: center;
        }
        
        .help-section h3 {
          color: #0369a1;
          font-size: 16px;
          margin-bottom: 8px;
        }
        
        .help-section p {
          color: #0284c7;
          font-size: 14px;
          margin: 0;
        }
        
        .closing {
          margin-top: 30px;
          font-size: 16px;
          color: #4b5563;
        }
        
        .signature {
          font-weight: 600;
          color: #1f2937;
        }
        
        .footer { 
          background-color: #f8fafc;
          padding: 30px;
          text-align: center;
          border-top: 1px solid #e5e7eb;
        }
        
        .footer p {
          font-size: 12px;
          color: #6b7280;
          margin: 5px 0;
        }
        
        .footer a {
          color: #667eea;
          text-decoration: none;
        }
        
        .footer a:hover {
          text-decoration: underline;
        }
        
        /* Mobile Responsive */
        @media (max-width: 600px) {
          .email-wrapper {
            padding: 20px 10px;
          }
          
          .container {
            border-radius: 8px;
          }
          
          .header {
            padding: 30px 20px;
          }
          
          .header h1 {
            font-size: 24px;
          }
          
          .content {
            padding: 30px 20px;
          }
          
          .otp-code {
            font-size: 28px;
            letter-spacing: 8px;
          }
          
          .footer {
            padding: 20px;
          }
        }
      </style>
    </head>
    <body>
      <div class="email-wrapper">
        <div class="container">
          <div class="header">
            <h1>Welcome to ${emailConfig.appName}!</h1>
            <p>Let's get your account verified</p>
          </div>
          
          <div class="content">
            <div class="greeting">Hello ${user.name},</div>
            
            <div class="welcome-message">
              Thank you for joining ${emailConfig.appName}! We're excited to have you on board. 
              To complete your registration and secure your account, please verify your email address using the verification code below.
            </div>
            
            <div class="otp-section">
              <div class="otp-label">Your Verification Code</div>
              <div class="otp-container">
                <div class="otp-code">${verificationOTP}</div>
              </div>
            </div>
            
            <div class="security-info">
              <span class="icon"></span>
              <p><strong>Important:</strong> This verification code will expire in 15 minutes for your security. Please use it promptly to activate your account.</p>
            </div>
            
            <div class="help-section">
              <h3>Need Help?</h3>
              <p>If you didn't create this account or have any questions, please don't hesitate to contact our support team.</p>
            </div>
            
            <div class="closing">
              Welcome aboard, and thank you for choosing ${emailConfig.appName}!
              <br><br>
              <span class="signature">The ${emailConfig.appName} Team</span>
            </div>
          </div>
          
          <div class="footer">
            <p>© ${new Date().getFullYear()} ${emailConfig.appName}. All rights reserved.</p>
            <p>Need assistance? Contact us at <a href="mailto:${emailConfig.supportEmail}">${emailConfig.supportEmail}</a></p>
            <p>This email was sent to ${user.email}</p>
          </div>
        </div>
      </div>
    </body>
    </html>
  `,
	text: `
    Welcome to ${emailConfig.appName}!
    
    Hello ${user.name},
    
    Thank you for joining ${emailConfig.appName}! We're excited to have you on board.
    
    To complete your registration and secure your account, please verify your email address using the verification code below:
    
    VERIFICATION CODE: ${verificationOTP}
    
    IMPORTANT SECURITY NOTICE:
    - This verification code will expire in 15 minutes for your security
    - Please use it promptly to activate your account
    - If you didn't create this account, please ignore this email
    
    Need Help?
    If you have any questions, please don't hesitate to contact our support team at ${emailConfig.supportEmail}.
    
    Welcome aboard, and thank you for choosing ${emailConfig.appName}!
    
    Best regards,
    The ${emailConfig.appName} Team
    
    ---
    © ${new Date().getFullYear()} ${emailConfig.appName}. All rights reserved.
    This email was sent to ${user.email}
    Need assistance? Contact us at ${emailConfig.supportEmail}
  `,
});
