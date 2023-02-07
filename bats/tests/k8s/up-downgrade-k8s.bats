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
    ctrctl run -d -p 8585:80 --restart=always --name nginx-restart nginx
}

#@test 'deploy nginx - no restart' {
 #   ctrctl pull nginx
  #  ctrctl run -d -p 8686:80 --restart=no --name nginx-no-restart nginx
#}

@test 'deploy busybox' {
    kubectl_exe create deploy busybox --image=busybox --replicas=2 -- /bin/sh -c "sleep inf"
    sleep 5
}

@test 'verify nginx before upgrade' {
    verify_nginx
}

verify_nginx() {
    run curl http://localhost:8585
    assert_success
    assert_output --partial "Welcome to nginx!"
}

@test 'verify busybox before upgrade' {
    verify_busybox
}

verify_busybox() {
    run kubectl_exe get pods -A | grep Running | grep  busybox- | wc -l
    assert_output --partial "2"
}

@test 'upgrade kubernetes' {
    rdctl set --kubernetes-version "$RD_KUBERNETES_VERSION"
    wait_for_apiserver "$RD_KUBERNETES_VERSION"
    wait_for_container_engine
}

@test 'verify nginx after upgrade' {
    verify_nginx
}

@test 'verify busybox after upgrade' {
    verify_busybox
}

@test 'downgrade kubernetes' {
    rdctl set --kubernetes-version "$RD_KUBERNETES_PREV_VERSION"
    wait_for_apiserver
    wait_for_container_engine
}

@test 'verify nginx after downgrade' {
    # nginx should still be running because it is not managed by kubernetes
    verify_nginx
}

@test 'verify busybox is gone after downgrade' {
    verify_busybox_gone
}
verify_busybox_gone() {
    run kubectl_exe get pods -A | grep  busybox- | wc -l
    assert_output --partial "0"
}

teardown_file() {
    load '../helpers/load'

    run ctrctl rm -f nginx
}
