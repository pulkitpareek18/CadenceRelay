"""
Email validation utilities
"""
import re
from typing import Tuple

def validate_email(email: str) -> Tuple[bool, str]:
    """
    Validate email address format
    
    Args:
        email: Email address to validate
        
    Returns:
        Tuple of (is_valid, error_message)
    """
    if not email or not isinstance(email, str):
        return False, "Email is empty or invalid type"
    
    email = email.strip()
    
    if not email:
        return False, "Email is empty after stripping whitespace"
    
    # Basic email regex pattern
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    
    if not re.match(pattern, email):
        return False, "Invalid email format"
    
    # Additional checks
    if email.count('@') != 1:
        return False, "Email must contain exactly one @ symbol"
    
    local_part, domain = email.split('@')
    
    if len(local_part) == 0 or len(local_part) > 64:
        return False, "Local part length must be between 1 and 64 characters"
    
    if len(domain) == 0 or len(domain) > 255:
        return False, "Domain length must be between 1 and 255 characters"
    
    if domain.startswith('.') or domain.endswith('.'):
        return False, "Domain cannot start or end with a period"
    
    if '..' in email:
        return False, "Email cannot contain consecutive periods"
    
    return True, "Valid"

def validate_school_name(school_name: str) -> Tuple[bool, str]:
    """
    Validate school name
    
    Args:
        school_name: School name to validate
        
    Returns:
        Tuple of (is_valid, error_message)
    """
    if not school_name or not isinstance(school_name, str):
        return False, "School name is empty or invalid type"
    
    school_name = school_name.strip()
    
    if not school_name:
        return False, "School name is empty after stripping whitespace"
    
    if len(school_name) < 2:
        return False, "School name is too short"
    
    return True, "Valid"
