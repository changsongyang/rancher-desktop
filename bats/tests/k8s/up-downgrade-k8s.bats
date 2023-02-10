# Test case 8 & 13

# shellcheck disable=SC2030,SC2031
# SC2030 (info): Modification of output is local (to subshell caused by @bats test).
# SC2031 (info): output was modified in a subshell. That change might be lost.

setup() {
    load '../helpers/load'
}

@test 'factory reset' {
    factory_reset
}

@test 'start rancher desktop' {
    start_kubernetes
    wait_for_apiserver
    # the docker context "rancher-desktop" may not have been written
    # even though the apiserver is already running
    wait_for_container_engine
}

@test 'deploy nginx - always restart' {
    ctrctl pull nginx
    run ctrctl run -d -p 8585:80 --restart=always --name nginx-restart nginx
    assert_success
}

@test 'deploy nginx - no restart' {
    run ctrctl run -d -p 8686:80 --restart=no --name nginx-no-restart nginx
    assert_success
}

@test 'deploy busybox' {
    run kubectl_exe create deploy busybox --image=busybox --replicas=2 -- /bin/sh -c "sleep inf"
    assert_success
}

verify_nginx() {
    local nginx_ports=(8585 8686)
    for port in "${nginx_ports[@]}"; do
        run curl http://localhost:"$port"
        assert_success
        assert_output --partial "Welcome to nginx!"
    done
}

@test 'verify nginx before upgrade' {
    try verify_nginx
}

verify_busybox() {
    run kubectl get pods --selector="app=busybox" -o jsonpath='{.items[*].status.phase}'
    assert_output --partial "Running Running"
}

@test 'verify busybox before upgrade' {
    try verify_busybox
}

verify_images() {
    if using_docker; then
        run ctrctl images
        assert_output --partial "nginx" "busybox"
    else
        run ctrctl images --format json
        assert_output --partial "\"Repository\":\"nginx"
        run ctrctl images --namespace k8s.io
        assert_output --partial "busybox"
    fi
}
@test 'verify images before upgrade' {
    verify_images
}

@test 'upgrade kubernetes' {
    rdctl set --kubernetes-version "$RD_KUBERNETES_VERSION"
    wait_for_apiserver "$RD_KUBERNETES_VERSION"
    wait_for_container_engine
}

verify_nginx_after_change_k8s() {
            run curl http://localhost:"8686"
            assert_failure
            assert_output --partial "Failed to connect to localhost port 8686"
            run curl http://localhost:"8585"
            assert_success
            assert_output --partial "Welcome to nginx!"
}

@test 'verify nginx after upgrade' {
    try verify_nginx_after_change_k8s
}

@test 'verify busybox after upgrade' {
    try verify_busybox
}

@test 'verify images after upgrade' {
    verify_images
}

restart_nginx() {
    run ctrctl start nginx-no-restart
    assert_success
}
@test 'restart nginx - no restart before downgrade' {
    try restart_nginx
}

@test 'downgrade kubernetes' {
    rdctl set --kubernetes-version "$RD_KUBERNETES_PREV_VERSION"
    wait_for_apiserver
    wait_for_container_engine
}

@test 'verify nginx after downgrade' {
    # nginx should still be running because it is not managed by kubernetes
    try verify_nginx_after_change_k8s
}

verify_busybox_gone() {
    run kubectl_exe get pods -A --selector="app=busybox"
    assert_output --partial "No resources found"
}

@test 'verify busybox is gone after downgrade' {
    verify_busybox_gone
}

@test 'verify images after downgrade' {
    verify_images
}

teardown_file() {
    load '../helpers/load'

    run ctrctl rm -f nginx
    run kubectl_exe delete --selector="app=busybox"
}
