FROM python:3.12-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY app app
COPY config config
RUN useradd -u 1000 -m ai && mkdir -p data && chown ai data
USER ai
EXPOSE 8080
CMD ["python", "-m", "app.main", "serve"]
