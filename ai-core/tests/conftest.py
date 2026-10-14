import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def sse(*chunks: str) -> bytes:
    """OpenAI 호환 스트리밍 응답 본문을 만든다."""
    lines = [f"data: {json.dumps({'choices': [{'delta': {'content': c}}]})}\n\n" for c in chunks]
    return ("".join(lines) + "data: [DONE]\n\n").encode()
