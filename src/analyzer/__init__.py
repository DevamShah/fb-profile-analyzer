"""Facebook Profile Authenticity Analyzer — 9-signal weighted scoring engine."""

from analyzer.engine import AnalysisEngine
from analyzer.models import AnalysisResult, ProfileData

__all__ = ["AnalysisEngine", "ProfileData", "AnalysisResult"]
__version__ = "1.0.0"
