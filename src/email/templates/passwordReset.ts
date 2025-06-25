import { emailConfig } from "../email";

export const passwordResetEmailWithOTP = (
	user: { name: string; email: string },
	resetOTP: string,
) => ({
	to: user.email,
	subject: `Password Reset Code for ${emailConfig.appName}`,
	html: `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background-color: #DC2626; padding: 20px; text-align: center; color: white; }
        .content { padding: 20px; background-color: #f9f9f9; }
        .otp-container { 
          background-color: white; 
          padding: 20px; 
          margin: 20px 0; 
          text-align: center; 
          border-radius: 8px;
          border: 2px dashed #DC2626;
        }
        .otp-code { 
          font-size: 32px; 
          font-weight: bold; 
          color: #DC2626; 
          letter-spacing: 8px;
          font-family: monospace;
        }
        .footer { margin-top: 20px; font-size: 12px; text-align: center; color: #666; }
        .warning { color: #DC2626; font-weight: bold; }
        .security-note { 
          background-color: #FEF2F2; 
          padding: 15px; 
          border-left: 4px solid #DC2626; 
          margin: 20px 0; 
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Password Reset Request</h1>
        </div>
        <div class="content">
          <p>Hello ${user.name},</p>
          <p>We received a request to reset your password for your ${emailConfig.appName} account.</p>
          <p>Use the following code to reset your password:</p>
          
          <div class="otp-container">
            <p>Your reset code is:</p>
            <div class="otp-code">${resetOTP}</div>
          </div>
          
          <div class="security-note">
            <p class="warning">Security Notice:</p>
            <ul>
              <li>This code will expire in 15 minutes</li>
              <li>Never share this code with anyone</li>
              <li>If you didn't request a password reset, please ignore this email</li>
              <li>Consider changing your password if you suspect unauthorized access</li>
            </ul>
          </div>
          
          <p>Best regards,<br/>The ${emailConfig.appName} Team</p>
        </div>
        <div class="footer">
          <p>© ${new Date().getFullYear()} ${emailConfig.appName}. All rights reserved.</p>
          <p>If you need assistance, please contact <a href="mailto:${emailConfig.supportEmail}">our support team</a>.</p>
        </div>
      </div>
    </body>
    </html>
  `,
	text: `
    Password Reset Request
    
    Hello ${user.name},
    
    We received a request to reset your password for your ${emailConfig.appName} account.
    
    Reset Code: ${resetOTP}
    
    SECURITY NOTICE:
    - This code will expire in 15 minutes
    - Never share this code with anyone
    - If you didn't request a password reset, please ignore this email
    - Consider changing your password if you suspect unauthorized access
    
    Best regards,
    The ${emailConfig.appName} Team
    
    ---
    © ${new Date().getFullYear()} ${emailConfig.appName}. All rights reserved.
    If you need assistance, please contact our support team at ${emailConfig.supportEmail}.
  `,
});

// Password Reset Confirmation Email
export const passwordResetConfirmationEmail = (user: {
	name: string;
	email: string;
}) => ({
	to: user.email,
	subject: `Password Successfully Reset for ${emailConfig.appName}`,
	html: `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background-color: #10B981; padding: 20px; text-align: center; color: white; }
        .content { padding: 20px; background-color: #f9f9f9; }
        .success-container { 
          background-color: white; 
          padding: 20px; 
          margin: 20px 0; 
          text-align: center; 
          border-radius: 8px;
          border: 2px solid #10B981;
        }
        .success-icon { 
          font-size: 48px; 
          color: #10B981; 
          margin-bottom: 15px;
        }
        .security-note { 
          background-color: #ECFDF5; 
          padding: 15px; 
          border-left: 4px solid #10B981; 
          margin: 20px 0; 
        }
        .footer { margin-top: 20px; font-size: 12px; text-align: center; color: #666; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Password Successfully Reset</h1>
        </div>
        <div class="content">
          <p>Hello ${user.name},</p>
          <p>Your password for ${emailConfig.appName} has been successfully reset.</p>
          
          <div class="success-container">
            <div class="success-icon">✓</div>
            <h2>Password Reset Confirmed</h2>
            <p>You can now log in with your new password.</p>
          </div>
          
          <div class="security-note">
            <p><strong>Security Notice:</strong></p>
            <ul>
              <li>This change was made at ${new Date().toLocaleString()}</li>
              <li>All active sessions have been terminated for security</li>
              <li>If you didn't make this change, please contact us immediately</li>
            </ul>
          </div>
          
          <p>Best regards,<br/>The ${emailConfig.appName} Team</p>
        </div>
        <div class="footer">
          <p>© ${new Date().getFullYear()} ${emailConfig.appName}. All rights reserved.</p>
          <p>If you need assistance, please contact <a href="mailto:${emailConfig.supportEmail}">our support team</a>.</p>
        </div>
      </div>
    </body>
    </html>
  `,
	text: `
    Password Successfully Reset
    
    Hello ${user.name},
    
    Your password for ${emailConfig.appName} has been successfully reset.
    
    Password Reset Confirmed
    ✓ You can now log in with your new password.
    
    SECURITY NOTICE:
    - This change was made at ${new Date().toLocaleString()}
    - All active sessions have been terminated for security
    - If you didn't make this change, please contact us immediately
    
    Best regards,
    The ${emailConfig.appName} Team
    
    ---
    © ${new Date().getFullYear()} ${emailConfig.appName}. All rights reserved.
    If you need assistance, please contact our support team at ${emailConfig.supportEmail}.
  `,
});

// Password Reset Confirmation Email
export const passwordChangeConfirmationEmail = (user: {
	name: string;
	email: string;
}) => ({
	to: user.email,
	subject: `Password Changed Successfully - ${emailConfig.appName}`,
	html: `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background-color: #10B981; padding: 20px; text-align: center; color: white; }
        .content { padding: 20px; background-color: #f9f9f9; }
        .success-container { 
          background-color: white; 
          padding: 20px; 
          margin: 20px 0; 
          text-align: center; 
          border-radius: 8px;
          border: 2px solid #10B981;
        }
        .success-icon { 
          font-size: 48px; 
          color: #10B981; 
          margin-bottom: 15px;
        }
        .security-note { 
          background-color: #ECFDF5; 
          padding: 15px; 
          border-left: 4px solid #10B981; 
          margin: 20px 0; 
        }
        .footer { margin-top: 20px; font-size: 12px; text-align: center; color: #666; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Password Changed Successfully</h1>
        </div>
        <div class="content">
          <p>Hello ${user.name},</p>
          <p>Your password for ${emailConfig.appName} has been successfully changed.</p>
          
          <div class="success-container">
            <div class="success-icon">✓</div>
            <h2>Password Change Confirmed</h2>
            <p>You can now log in with your new password.</p>
          </div>
          
          <div class="security-note">
            <p><strong>Security Notice:</strong></p>
            <ul>
              <li>This change was made at ${new Date().toLocaleString()}</li>
              <li>All active sessions have been terminated for security</li>
              <li>If you didn't make this change, please contact us immediately</li>
            </ul>
          </div>
          
          <p>Best regards,<br/>The ${emailConfig.appName} Team</p>
        </div>
        <div class="footer">
          <p>© ${new Date().getFullYear()} ${emailConfig.appName}. All rights reserved.</p>
          <p>If you need assistance, please contact <a href="mailto:${emailConfig.supportEmail}">our support team</a>.</p>
        </div>
      </div>
    </body>
    </html>
  `,
	text: `
    Password Changed Successfully
    
    Hello ${user.name},
    
    Your password for ${emailConfig.appName} has been successfully changed.
    
    Password Change Confirmed
    ✓ You can now log in with your new password.
    
    SECURITY NOTICE:
    - This change was made at ${new Date().toLocaleString()}
    - All active sessions have been terminated for security
    - If you didn't make this change, please contact us immediately
    
    Best regards,
    The ${emailConfig.appName} Team
    
    ---
    © ${new Date().getFullYear()} ${emailConfig.appName}. All rights reserved.
    If you need assistance, please contact our support team at ${emailConfig.supportEmail}.
  `,
});
