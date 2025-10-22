from invoke import task


@task
def run(c, host="0.0.0.0", port=8080):
    c.run(f"uvicorn worker.app.main:app --host {host} --port {port}")


@task
def test(c):
    c.run("pytest -q")


@task
def docker_build(c):
    c.run("docker build -t worker-service:dev .")


@task
def docker_run(c, port=8080, secret="dev-secret"):
    c.run(
        f"docker run --rm -it -p {port}:8080 -e WORKER_WORKER_SHARED_SECRET={secret} worker-service:dev"
    )
