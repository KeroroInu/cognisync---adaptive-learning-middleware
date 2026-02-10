"""
Calibration Endpoint - 校准日志接口
"""
import logging
from fastapi import APIRouter

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("")
async def record_calibration():
    """记录校准日志"""
    return {"success": True, "message": "Calibration recorded"}
