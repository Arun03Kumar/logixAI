# Sandbox image for ML Arena (language PYTHON_ML in packages/languages).
# Build: npm run judge:images   ->  logixai/python-ml:4
#
# CPU only. Bump the tag (and packages/languages) when changing versions, so a
# running evaluator never mixes old and new images.
FROM python:3.12-slim

# PyTorch first (largest layer, changes least): the CPU-only wheel.
RUN pip install --no-cache-dir torch==2.5.1 --index-url https://download.pytorch.org/whl/cpu \
 && python -c "import torch"

RUN pip install --no-cache-dir \
      numpy==2.1.3 \
      pandas==2.2.3 \
      scipy==1.14.1 \
      scikit-learn==1.5.2 \
      duckdb==1.1.3 \
 && python -c "import numpy, pandas, scipy, sklearn, duckdb, torch; torch.zeros(1).numpy()"

# LLM and agent labs: LangGraph and LangChain core. No model providers and no
# network in the sandbox — labs use scripted fake models.
RUN pip install --no-cache-dir \
      langgraph==0.2.62 \
      langchain-core==0.3.29 \
 && python -c "import langgraph.graph, langgraph.prebuilt, langgraph.checkpoint.memory, langchain_core.messages"

# One thread per sandbox: the container gets one CPU, and extra BLAS threads
# would only fight over it (and count against the process limit).
ENV OPENBLAS_NUM_THREADS=1 \
    OMP_NUM_THREADS=1 \
    MKL_NUM_THREADS=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /sandbox
