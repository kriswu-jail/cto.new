SHELL := /bin/bash

export WORKER_PORT ?= 8080
export WORKER_WORKER_SHARED_SECRET ?= dev-secret

.PHONY: help install run docker-build docker-run test fmt

help:
	@echo "Targets: install, run, docker-build, docker-run, test"

install:
	@echo "Installing dependencies with pip (for convenience). Use Poetry in dev if preferred."
	python -m pip install --upgrade pip
	pip install -e .

run:
	uvicorn worker.app.main:app --host 0.0.0.0 --port $(WORKER_PORT)

docker-build:
	docker build -t worker-service:dev .

docker-run:
	docker run --rm -it -p $(WORKER_PORT):8080 \
	  -e WORKER_WORKER_SHARED_SECRET=$(WORKER_WORKER_SHARED_SECRET) \
	  worker-service:dev

test:
	pytest -q

fmt:
	python -m pip install black ruff --quiet || true
	ruff check --fix || true
	black . || true
