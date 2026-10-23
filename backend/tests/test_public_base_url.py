import pytest
from pydantic import ValidationError

from app.core.config import Settings


@pytest.mark.parametrize('value,expected', [('', ''), (' https://class.example.edu/ ', 'https://class.example.edu'), ('http://127.0.0.1:8003', 'http://127.0.0.1:8003')])
def test_public_origin(value, expected):
    assert Settings(_env_file=None, PUBLIC_BASE_URL=value).PUBLIC_BASE_URL == expected


@pytest.mark.parametrize('value', ['file:///etc/passwd', 'https://user:secret@example.org', 'https://example.org/path', 'https://example.org?key=a', 'https://example.org#fragment', 'https://', 'https://example.org:99999', 'https://bad host'])
def test_invalid_origin(value):
    with pytest.raises(ValidationError):
        Settings(_env_file=None, PUBLIC_BASE_URL=value)
