# Sandbox image for ML Arena (language PYTHON_ML in packages/languages).
# Build: npm run judge:images   ->  logixai/python-ml:1
#
# CPU only. Bump the tag (and packages/languages) when changing versions, so a
# running evaluator never mixes old and new images.
FROM python:3.12-slim

RUN pip install --no-cache-dir \
      numpy==2.1.3 \
      pandas==2.2.3 \
      scipy==1.14.1 \
      scikit-learn==1.5.2 \
 && python -c "import numpy, pandas, scipy, sklearn"

# One thread per sandbox: the container gets one CPU, and extra BLAS threads
# would only fight over it (and count against the process limit).
ENV OPENBLAS_NUM_THREADS=1 \
    OMP_NUM_THREADS=1 \
    MKL_NUM_THREADS=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /sandbox
