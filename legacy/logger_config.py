"""
Logging configuration for the email sender
"""
import logging
import os
from datetime import datetime
import config

def setup_logger():
    """Setup and configure logger with file and console handlers"""
    
    # Create logs directory if it doesn't exist
    if not os.path.exists(config.LOG_DIR):
        os.makedirs(config.LOG_DIR)
    
    # Create logger
    logger = logging.getLogger('EmailSender')
    logger.setLevel(logging.DEBUG)
    
    # Prevent duplicate handlers
    if logger.handlers:
        return logger
    
    # Create formatters
    detailed_formatter = logging.Formatter(
        '%(asctime)s - %(name)s - %(levelname)s - %(funcName)s:%(lineno)d - %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )
    
    simple_formatter = logging.Formatter(
        '%(asctime)s - %(levelname)s - %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )
    
    # File handler - detailed logs
    file_handler = logging.FileHandler(config.LOG_FILE, encoding='utf-8')
    file_handler.setLevel(logging.DEBUG)
    file_handler.setFormatter(detailed_formatter)
    
    # Console handler - simplified logs
    console_handler = logging.StreamHandler()
    console_handler.setLevel(logging.INFO)
    console_handler.setFormatter(simple_formatter)
    
    # Add handlers to logger
    logger.addHandler(file_handler)
    logger.addHandler(console_handler)
    
    return logger

def log_email_result(email, school_name, status, message, timestamp=None):
    """Log email sending result to CSV file"""
    if timestamp is None:
        timestamp = datetime.now().isoformat()
    
    # Create logs directory if it doesn't exist
    if not os.path.exists(config.LOG_DIR):
        os.makedirs(config.LOG_DIR)
    
    # Check if file exists to determine if we need to write headers
    file_exists = os.path.exists(config.RESULTS_LOG)
    
    with open(config.RESULTS_LOG, 'a', encoding='utf-8') as f:
        if not file_exists:
            f.write("timestamp,email,school_name,status,message\n")
        
        # Escape commas and quotes in message
        message = message.replace('"', '""')
        f.write(f'{timestamp},"{email}","{school_name}",{status},"{message}"\n')
