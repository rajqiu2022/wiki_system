# Wiki System Docker Image
FROM python:3.10-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    nginx \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for better caching
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install mkdocs and material theme
RUN pip install --no-cache-dir mkdocs mkdocs-material

# Copy application code
COPY backend/app ./app
COPY docs ./docs
COPY mkdocs.yml .

# Build mkdocs site
RUN mkdocs build

# Expose port
EXPOSE 8001

# Start uvicorn server
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
