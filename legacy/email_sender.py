"""
Core email sending functionality with retry logic and rate limiting
"""
import smtplib
import time
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import Tuple, Optional
from datetime import datetime

import config
from logger_config import setup_logger, log_email_result
from email_validator import validate_email, validate_school_name

logger = setup_logger()

class EmailSender:
    """Email sender with Gmail SMTP support"""
    
    def __init__(self):
        self.smtp_server = config.SMTP_SERVER
        self.smtp_port = config.SMTP_PORT
        self.sender_email = config.SENDER_EMAIL
        self.sender_password = config.SENDER_PASSWORD
        self.sender_name = config.SENDER_NAME
        self.email_subject = config.EMAIL_SUBJECT
        self.connection = None
        
        logger.info(f"EmailSender initialized for {self.sender_email}")
    
    def connect(self) -> bool:
        """
        Establish SMTP connection
        
        Returns:
            True if connection successful, False otherwise
        """
        try:
            logger.debug(f"Connecting to {self.smtp_server}:{self.smtp_port}")
            self.connection = smtplib.SMTP(self.smtp_server, self.smtp_port, timeout=30)
            self.connection.ehlo()
            self.connection.starttls()
            self.connection.ehlo()
            self.connection.login(self.sender_email, self.sender_password)
            logger.info("Successfully connected to SMTP server")
            return True
        except smtplib.SMTPAuthenticationError as e:
            logger.error(f"SMTP Authentication failed: {e}")
            return False
        except smtplib.SMTPException as e:
            logger.error(f"SMTP error during connection: {e}")
            return False
        except Exception as e:
            logger.error(f"Unexpected error during connection: {e}")
            return False
    
    def disconnect(self):
        """Close SMTP connection"""
        if self.connection:
            try:
                self.connection.quit()
                logger.info("Disconnected from SMTP server")
            except Exception as e:
                logger.warning(f"Error during disconnect: {e}")
            finally:
                self.connection = None
    
    def create_email(self, recipient_email: str, school_name: str, 
                     email_body: str) -> Optional[MIMEMultipart]:
        """
        Create email message
        
        Args:
            recipient_email: Recipient's email address
            school_name: Name of the school
            email_body: HTML body of the email
            
        Returns:
            MIMEMultipart message or None if creation fails
        """
        try:
            msg = MIMEMultipart('alternative')
            msg['From'] = f"{self.sender_name} <{self.sender_email}>"
            msg['To'] = recipient_email
            msg['Subject'] = self.email_subject
            
            # Add headers for better deliverability
            msg['Reply-To'] = self.sender_email
            msg['X-Mailer'] = 'Bulk Email Sender v1.0'
            
            # Attach HTML body
            html_part = MIMEText(email_body, 'html', 'utf-8')
            msg.attach(html_part)
            
            return msg
        except Exception as e:
            logger.error(f"Error creating email for {recipient_email}: {e}")
            return None
    
    def send_email(self, recipient_email: str, school_name: str, 
                   email_body: str) -> Tuple[bool, str]:
        """
        Send a single email with retry logic
        
        Args:
            recipient_email: Recipient's email address
            school_name: Name of the school
            email_body: HTML body of the email
            
        Returns:
            Tuple of (success, message)
        """
        # Validate inputs
        is_valid, error_msg = validate_email(recipient_email)
        if not is_valid:
            logger.warning(f"Invalid email {recipient_email}: {error_msg}")
            return False, f"Validation failed: {error_msg}"
        
        is_valid, error_msg = validate_school_name(school_name)
        if not is_valid:
            logger.warning(f"Invalid school name for {recipient_email}: {error_msg}")
            return False, f"Validation failed: {error_msg}"
        
        # Retry logic
        for attempt in range(1, config.MAX_RETRIES + 1):
            try:
                # Ensure connection
                if not self.connection:
                    if not self.connect():
                        if attempt < config.MAX_RETRIES:
                            logger.warning(f"Connection failed, retrying in {config.RETRY_DELAY}s "
                                         f"(attempt {attempt}/{config.MAX_RETRIES})")
                            time.sleep(config.RETRY_DELAY)
                            continue
                        else:
                            return False, "Failed to connect to SMTP server after retries"
                
                # Create and send email
                msg = self.create_email(recipient_email, school_name, email_body)
                if not msg:
                    return False, "Failed to create email message"
                
                logger.debug(f"Sending email to {recipient_email} ({school_name})")
                self.connection.send_message(msg)
                
                logger.info(f"✓ Successfully sent email to {recipient_email} ({school_name})")
                return True, "Email sent successfully"
                
            except smtplib.SMTPException as e:
                error_msg = f"SMTP error: {str(e)}"
                logger.error(f"Attempt {attempt}/{config.MAX_RETRIES} - {error_msg} "
                           f"for {recipient_email}")
                
                # Reconnect on SMTP errors
                self.disconnect()
                
                if attempt < config.MAX_RETRIES:
                    logger.info(f"Retrying in {config.RETRY_DELAY} seconds...")
                    time.sleep(config.RETRY_DELAY)
                else:
                    return False, error_msg
                    
            except Exception as e:
                error_msg = f"Unexpected error: {str(e)}"
                logger.error(f"Attempt {attempt}/{config.MAX_RETRIES} - {error_msg} "
                           f"for {recipient_email}")
                
                if attempt < config.MAX_RETRIES:
                    logger.info(f"Retrying in {config.RETRY_DELAY} seconds...")
                    time.sleep(config.RETRY_DELAY)
                else:
                    return False, error_msg
        
        return False, "Max retries exceeded"
    
    def send_bulk_emails(self, recipients: list, email_template: str) -> dict:
        """
        Send emails to multiple recipients with rate limiting
        
        Args:
            recipients: List of dicts with 'email' and 'school_name'
            email_template: HTML template with {school_name} and {email} placeholders
            
        Returns:
            Dictionary with statistics
        """
        stats = {
            'total': len(recipients),
            'sent': 0,
            'failed': 0,
            'skipped': 0,
            'start_time': datetime.now()
        }
        
        logger.info(f"Starting bulk email send to {stats['total']} recipients")
        
        # Connect once for all emails
        if not self.connect():
            logger.error("Failed to establish initial SMTP connection")
            stats['end_time'] = datetime.now()
            stats['duration'] = (stats['end_time'] - stats['start_time']).total_seconds()
            return stats
        
        try:
            for idx, recipient in enumerate(recipients, 1):
                email = recipient.get('email', '').strip()
                school_name = recipient.get('school_name', '').strip()
                
                if not email or not school_name:
                    logger.warning(f"Skipping recipient {idx}: missing email or school name")
                    stats['skipped'] += 1
                    log_email_result(email, school_name, 'SKIPPED', 
                                   'Missing email or school name')
                    continue
                
                # Personalize email
                personalized_body = email_template.format(
                    school_name=school_name,
                    email=email
                )
                
                # Send email
                logger.info(f"Processing {idx}/{stats['total']}: {email} ({school_name})")
                success, message = self.send_email(email, school_name, personalized_body)
                
                # Log result
                if success:
                    stats['sent'] += 1
                    log_email_result(email, school_name, 'SUCCESS', message)
                else:
                    stats['failed'] += 1
                    log_email_result(email, school_name, 'FAILED', message)
                
                # Rate limiting
                if idx < stats['total']:  # Don't sleep after last email
                    # Batch delay
                    if idx % config.EMAILS_PER_BATCH == 0:
                        logger.info(f"Batch complete ({idx} emails sent). "
                                  f"Waiting {config.DELAY_BETWEEN_BATCHES}s before next batch...")
                        time.sleep(config.DELAY_BETWEEN_BATCHES)
                    else:
                        # Regular delay between emails
                        time.sleep(config.DELAY_BETWEEN_EMAILS)
        
        finally:
            self.disconnect()
        
        stats['end_time'] = datetime.now()
        stats['duration'] = (stats['end_time'] - stats['start_time']).total_seconds()
        
        logger.info(f"Bulk email send completed in {stats['duration']:.2f}s")
        logger.info(f"Results: {stats['sent']} sent, {stats['failed']} failed, "
                   f"{stats['skipped']} skipped out of {stats['total']} total")
        
        return stats
