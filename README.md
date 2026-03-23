# Bulk Email Sender

A robust, production-ready bulk email sender for sending personalized emails to schools using Gmail SMTP.

## Features

✅ **Gmail SMTP Integration** - Uses secure Gmail SMTP with TLS encryption  
✅ **Comprehensive Logging** - Detailed logs and CSV results tracking  
✅ **Error Handling** - Automatic retry mechanism with exponential backoff  
✅ **Rate Limiting** - Respects Gmail sending limits  
✅ **Email Validation** - Validates email formats before sending  
✅ **Personalization** - Template-based emails with dynamic content  
✅ **Production Ready** - Robust error handling and recovery  
✅ **Progress Tracking** - Real-time progress updates and statistics  

## Prerequisites

- Python 3.7 or higher
- Gmail account with App Password enabled

## Setup Instructions

### 1. Gmail Configuration

To use Gmail SMTP, you need to enable 2-Step Verification and create an App Password:

1. Go to your Google Account settings: https://myaccount.google.com/
2. Select **Security** from the left menu
3. Under "Signing in to Google," enable **2-Step Verification** (if not already enabled)
4. After enabling 2-Step Verification, go back to Security
5. Under "Signing in to Google," click on **App passwords**
6. Select **Mail** and **Other (Custom name)**
7. Enter a name like "Bulk Email Sender"
8. Click **Generate**
9. Copy the 16-character password (you'll use this in the .env file)

### 2. Installation

```bash
# Clone or download the repository
cd Bulk-Email-Sender

# Install dependencies
pip install -r requirements.txt
```

### 3. Configuration

Create a `.env` file from the example:

```bash
cp .env.example .env
```

Edit the `.env` file with your credentials:

```env
SENDER_EMAIL=your_email@gmail.com
SENDER_PASSWORD=your_16_char_app_password
SENDER_NAME=Your Organization Name
EMAIL_SUBJECT=Important Information for Your School
```

### 4. Prepare Data

Edit `data.csv` with your recipient list:

```csv
email,school_name
principal@school1.edu,Washington High School
admin@school2.edu,Lincoln Elementary
contact@school3.edu,Jefferson Middle School
```

### 5. Customize Email Template

Edit `email_template.html` to customize your email content. Use these placeholders:
- `{school_name}` - Replaced with the school name
- `{email}` - Replaced with the recipient email

## Usage

Run the email sender:

```bash
python main.py
```

The script will:
1. Validate configuration
2. Load recipients from `data.csv`
3. Ask for confirmation before sending
4. Send emails with rate limiting
5. Log all results to `logs/` directory

## Configuration Options

Edit `config.py` to adjust settings:

```python
# Rate Limiting
EMAILS_PER_BATCH = 10           # Emails per batch
DELAY_BETWEEN_EMAILS = 2        # Seconds between emails
DELAY_BETWEEN_BATCHES = 60      # Seconds between batches

# Retry Configuration
MAX_RETRIES = 3                 # Number of retry attempts
RETRY_DELAY = 5                 # Seconds between retries
```

## Gmail Sending Limits

**Important:** Gmail has sending limits to prevent spam:

- **Free Gmail:** ~100-500 emails per day
- **Google Workspace:** ~2,000 emails per day

To avoid hitting limits:
- Keep `EMAILS_PER_BATCH` low (10-20)
- Use longer delays between batches
- For large campaigns, split into multiple days

## Logs and Results

All activity is logged in the `logs/` directory:

- `email_sender.log` - Detailed technical logs
- `email_results.csv` - CSV file with results for each email

Results CSV format:
```csv
timestamp,email,school_name,status,message
2025-11-16T10:30:45,admin@school.edu,Washington High,SUCCESS,Email sent successfully
```

## Troubleshooting

### Authentication Failed

- Verify you're using an App Password (not your regular Gmail password)
- Ensure 2-Step Verification is enabled
- Check that SENDER_EMAIL and SENDER_PASSWORD are correct in .env

### Connection Timeout

- Check your internet connection
- Verify firewall isn't blocking port 587
- Try using a different network

### Emails Going to Spam

- Verify your domain's SPF/DKIM records
- Avoid spam trigger words in subject/content
- Don't send too many emails too quickly
- Ensure recipients have opted in

### Rate Limiting

- Gmail may temporarily block if you send too fast
- Increase delays in config.py
- Split large campaigns across multiple days

## Security Best Practices

1. **Never commit .env file** - Added to .gitignore
2. **Use App Passwords** - Never use your main Gmail password
3. **Rotate passwords regularly** - Generate new app passwords periodically
4. **Secure your logs** - Contains sensitive email addresses
5. **Backup data** - Keep backups of data.csv and logs

## File Structure

```
Bulk-Email-Sender/
├── main.py                 # Main entry point
├── config.py              # Configuration settings
├── email_sender.py        # Core email sending logic
├── email_validator.py     # Email validation utilities
├── logger_config.py       # Logging configuration
├── email_template.html    # HTML email template
├── data.csv              # Recipient data
├── requirements.txt      # Python dependencies
├── .env                  # Environment variables (create from .env.example)
├── .env.example          # Example environment file
├── README.md             # This file
└── logs/                 # Generated logs directory
    ├── email_sender.log
    └── email_results.csv
```

## Support

For issues or questions:
1. Check the logs in `logs/email_sender.log`
2. Review this README thoroughly
3. Verify your Gmail App Password is correct

## License

This project is provided as-is for educational and business purposes.
