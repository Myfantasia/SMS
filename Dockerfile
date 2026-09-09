# --- Base image: official Python 3.12, "slim" = fewer preinstalled OS packages ---
FROM python:3.12-slim

# Don't buffer stdout/stderr — logs show up immediately in `docker logs`
ENV PYTHONUNBUFFERED=1
# Don't write .pyc files inside the container — pointless in a throwaway image layer
ENV PYTHONDONTWRITEBYTECODE=1

# OS-level packages needed to build psycopg2 (Postgres client) and Pillow (image lib)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    libjpeg-dev \
    zlib1g-dev \
    && rm -rf /var/lib/apt/lists/*

# Everything from here runs inside /app in the container
WORKDIR /app

# Copy ONLY requirements first — Docker caches each instruction as a "layer".
# If requirements.txt hasn't changed, this layer (and the slow pip install) is
# reused from cache on the next build, even if your app code changed.
COPY requirements.txt .
RUN pip install --no-cache-dir --default-timeout=180 --retries 10 -r requirements.txt

# Now copy the rest of the actual project code
COPY . .

# Document that the container listens on 8000 (informational — doesn't publish it)
EXPOSE 8000

# Default command when a container starts from this image
CMD ["daphne", "-b", "0.0.0.0", "-p", "8000", "schoolmanagement.asgi:application"]
