"""
Bulk Email Sender - Production Ready
Sends personalized emails to schools using Gmail SMTP with comprehensive logging and error handling
"""
import os
import sys
import csv
from datetime import datetime

import config
from logger_config import setup_logger
from email_sender import EmailSender

logger = setup_logger()

def load_email_template(template_path: str) -> str:
    """
    Load email template from file
    
    Args:
        template_path: Path to HTML template file
        
    Returns:
        Template content as string
    """
    try:
        with open(template_path, 'r', encoding='utf-8') as f:
            return f.read()
    except FileNotFoundError:
        logger.error(f"Template file not found: {template_path}")
        sys.exit(1)
    except Exception as e:
        logger.error(f"Error reading template file: {e}")
        sys.exit(1)

def load_recipients(csv_path: str) -> list:
    """
    Load recipients from CSV file
    
    Args:
        csv_path: Path to CSV file with email and school_name columns
        
    Returns:
        List of dictionaries with recipient data
    """
    recipients = []
    
    try:
        with open(csv_path, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            
            # Validate required columns
            if 'email' not in reader.fieldnames or 'school_name' not in reader.fieldnames:
                logger.error("CSV must contain 'email' and 'school_name' columns")
                sys.exit(1)
            
            for row_num, row in enumerate(reader, start=2):  # Start at 2 (header is row 1)
                email = row.get('email', '').strip()
                school_name = row.get('school_name', '').strip()
                
                if email or school_name:  # Skip completely empty rows
                    recipients.append({
                        'email': email,
                        'school_name': school_name,
                        'row_number': row_num
                    })
        
        logger.info(f"Loaded {len(recipients)} recipients from {csv_path}")
        return recipients
        
    except FileNotFoundError:
        logger.error(f"Data file not found: {csv_path}")
        sys.exit(1)
    except Exception as e:
        logger.error(f"Error reading data file: {e}")
        sys.exit(1)

def print_statistics(stats: dict):
    """Print formatted statistics"""
    print("\n" + "="*60)
    print("EMAIL SENDING COMPLETED")
    print("="*60)
    print(f"Total recipients:     {stats['total']}")
    print(f"Successfully sent:    {stats['sent']} ({stats['sent']/stats['total']*100:.1f}%)")
    print(f"Failed:               {stats['failed']} ({stats['failed']/stats['total']*100:.1f}%)")
    print(f"Skipped:              {stats['skipped']} ({stats['skipped']/stats['total']*100:.1f}%)")
    print(f"Duration:             {stats['duration']:.2f} seconds")
    print(f"\nDetailed logs saved to: {config.LOG_FILE}")
    print(f"Results CSV saved to:   {config.RESULTS_LOG}")
    print("="*60 + "\n")

def verify_configuration():
    """Verify that all required configuration is set"""
    issues = []
    
    if not config.SENDER_EMAIL:
        issues.append("SENDER_EMAIL not set in .env file")
    
    if not config.SENDER_PASSWORD:
        issues.append("SENDER_PASSWORD not set in .env file")
    
    if not os.path.exists(config.DATA_FILE):
        issues.append(f"Data file not found: {config.DATA_FILE}")
    
    if not os.path.exists(config.EMAIL_TEMPLATE_PATH):
        issues.append(f"Email template not found: {config.EMAIL_TEMPLATE_PATH}")
    
    if issues:
        logger.error("Configuration issues detected:")
        for issue in issues:
            logger.error(f"  - {issue}")
        print("\nPlease fix the configuration issues and try again.")
        print("See README.md for setup instructions.")
        sys.exit(1)

def main():
    """Main entry point"""
    logger.info("="*60)
    logger.info("BULK EMAIL SENDER STARTED")
    logger.info("="*60)
    logger.info(f"Timestamp: {datetime.now().isoformat()}")
    
    # Verify configuration
    verify_configuration()
    
    # Load recipients and template
    recipients = load_recipients(config.DATA_FILE)
    if not recipients:
        logger.warning("No recipients found in data file")
        print("No recipients to process. Please add recipients to data.csv")
        sys.exit(0)
    
    template = load_email_template(config.EMAIL_TEMPLATE_PATH)
    
    # Confirm before sending
    print(f"\nReady to send emails to {len(recipients)} recipients")
    print(f"Sender: {config.SENDER_NAME} <{config.SENDER_EMAIL}>")
    print(f"Subject: {config.EMAIL_SUBJECT}")
    
    response = input("\nDo you want to proceed? (yes/no): ").strip().lower()
    if response not in ['yes', 'y']:
        logger.info("User cancelled email sending")
        print("Email sending cancelled")
        sys.exit(0)
    
    # Send emails
    sender = EmailSender()
    stats = sender.send_bulk_emails(recipients, template)
    
    # Print statistics
    print_statistics(stats)
    
    logger.info("="*60)
    logger.info("BULK EMAIL SENDER FINISHED")
    logger.info("="*60)

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        logger.warning("\nProcess interrupted by user")
        print("\n\nEmail sending interrupted by user")
        sys.exit(1)
    except Exception as e:
        logger.critical(f"Unexpected error in main: {e}", exc_info=True)
        print(f"\nCritical error: {e}")
        print(f"Check logs at {config.LOG_FILE} for details")
        sys.exit(1)
