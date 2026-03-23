"""
Configuration file for Bulk Email Sender
"""
import os
from dotenv import load_dotenv

load_dotenv()

# Email Configuration
SMTP_SERVER = "smtp.gmail.com"
SMTP_PORT = 587
SENDER_EMAIL = os.getenv("SENDER_EMAIL")
SENDER_PASSWORD = os.getenv("SENDER_PASSWORD")  # App password for Gmail
SENDER_NAME = os.getenv("SENDER_NAME", "Your Organization")

# Email Content Configuration
EMAIL_SUBJECT = os.getenv("EMAIL_SUBJECT", "Important Information")
EMAIL_TEMPLATE_PATH = "email_template.html"

# Rate Limiting (Gmail allows ~100-500 emails per day for free accounts)
EMAILS_PER_BATCH = 10
DELAY_BETWEEN_EMAILS = 2  # seconds
DELAY_BETWEEN_BATCHES = 60  # seconds

# Retry Configuration
MAX_RETRIES = 3
RETRY_DELAY = 5  # seconds

# Logging Configuration
LOG_DIR = "logs"
LOG_FILE = os.path.join(LOG_DIR, "email_sender.log")
RESULTS_LOG = os.path.join(LOG_DIR, "email_results.csv")

# Data Configuration
DATA_FILE = "data.csv"

# Validation
if not SENDER_EMAIL or not SENDER_PASSWORD:
    raise ValueError("SENDER_EMAIL and SENDER_PASSWORD must be set in .env file")
