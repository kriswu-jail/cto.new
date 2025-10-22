# syntax=docker/dockerfile:1
FROM python:3.11-slim as base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    DEBIAN_FRONTEND=noninteractive

# System packages
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    ca-certificates \
    git \
    # PDF/Image processing
    poppler-utils \
    ghostscript \
    # LibreOffice for Office->PDF
    libreoffice \
    # Java for tabula-py
    default-jre \
    # OpenCV dependencies
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender1 \
    libgl1 \
    # Chinese fonts
    fonts-noto-cjk \
    fonts-wqy-zenhei \
    # tkinter for camelot (on slim we use tk libs)
    tk \
    # Misc tools
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy and install Python dependencies quickly via Poetry or pip
# Here we use pip to avoid requiring Poetry inside the image
COPY pyproject.toml /app/pyproject.toml
RUN pip install --upgrade pip && \
    pip install "uvicorn[standard]" fastapi pydantic pydantic-settings python-multipart \
                pandas openpyxl pdf2image camelot-py[cv] tabula-py opencv-python-headless \
                paddlepaddle paddleocr httpx requests

# Copy source
COPY worker /app/worker

# Env
ENV WORKER_WORKER_SHARED_SECRET=change-me \
    WORKER_HOST=0.0.0.0 \
    WORKER_PORT=8080

EXPOSE 8080

CMD ["uvicorn", "worker.app.main:app", "--host", "0.0.0.0", "--port", "8080"]
