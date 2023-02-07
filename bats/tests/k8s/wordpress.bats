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

@test 'add helm repo' {
    helm repo add bitnami https://charts.bitnami.com/bitnami
    helm repo update bitnami
}

@test 'start rancher desktop' {
    start_kubernetes
    wait_for_apiserver
    # the docker context "rancher-desktop" may not have been written
    # even though the apiserver is already running
    wait_for_container_engine
}

@test 'deploy nginx' {
    ctrctl pull nginx
    ctrctl run -d -p 8585:80 --restart=always --name nginx nginx
}

verify_nginx() {
    run curl http://localhost:8585
    assert_success
    assert_output --partial "Welcome to nginx!"
}

@test 'deploy rancher' {
    deploy_rancher
}

deploy_rancher() {
    local rancher_image="rancher/rancher:$RD_RANCHER_IMAGE_TAG"
    ctrctl pull "$rancher_image"
    ctrctl run --privileged -d --restart=no -p 8080:80 -p 8443:443 --name rancher "$rancher_image"
}
verify_rancher() {
    try --max 9 --delay 10 curl --insecure --silent --show-error "https://localhost:8443/dashboard/auth/login"
    assert_success
    assert_output --partial "Rancher Dashboard"
    run ctrctl logs rancher
    assert_success
    assert_output --partial "Bootstrap Password:"
}

@test 'deploy busybox' {
    kubectl_exe create deploy busybox --image=busybox --replicas=2 -- /bin/sh -c "sleep inf"
}

verify_busybox() {
    run kubectl_exe get pods -A | grep Running | grep  busybox- | wc -l
    assert_output 2
}

@test 'deploy wordpress' {
    helm install wordpress bitnami/wordpress \
          --wait \
          --timeout 20m \
          --set service.type=NodePort \
          --set volumePermissions.enabled=true \
          --set mariadb.volumePermissions.enabled=true
}

verify_wordpress() {
    run helm list
    assert_success
    assert_line --regexp "$(printf '^wordpress[ \t]+default')"

    # Fetch wordpress port
    run kubectl get --namespace default -o jsonpath="{.spec.ports[0].nodePort}" services wordpress
    assert_success

    # Load the homepage; that can take a while because all the pods are still restarting
    try --max 9 --delay 10 curl --silent --show-error "http://localhost:$output"
    assert_success
    assert_output --regexp "(Just another WordPress site|<title>User&#039;s Blog!</title>)"
}

@test 'verify nginx before upgrade' {
    verify_nginx
}

@test 'verify wordpress before upgrade' {
    verify_wordpress
}

@test 'verify rancher before upgrade' {
    verify_rancher
}

@test 'verify busybox before upgrade' {
    verify_busybox
}

@test 'upgrade kubernetes' {
    rdctl set --kubernetes-version "$RD_KUBERNETES_VERSION"
    wait_for_apiserver "$RD_KUBERNETES_VERSION"
}

@test 'verify nginx after upgrade' {
    verify_nginx
}

@test 'verify wordpress after upgrade' {
    verify_wordpress
}

@test 'verify rancher after upgrade' {
    verify_rancher_gone
}

@test 'verify busybox after upgrade' {
    verify_busybox
}

@test 'deploy rancher before downgrade' {
    deploy_rancher
}

@test 'verify rancher before downgrade' {
    verify_rancher
}

@test 'downgrade kubernetes' {
    rdctl set --kubernetes-version "$RD_KUBERNETES_PREV_VERSION"
    wait_for_apiserver
}

@test 'verify nginx after downgrade' {
    # nginx should still be running because it is not managed by kubernetes
    verify_nginx
}

@test 'verify wordpress is gone after downgrade' {
    # downgrading kubernetes deletes all workloads
    run helm list
    assert_success
    refute_line --regexp "$(printf '^wordpress[ \t]+default')"
    #verify_wordpress
}

@test 'verify rancher is gone after downgrade' {
    verify_rancher_gone
}

verify_rancher_gone() {
    run ctrctl ps
    assert_success
    refute_line --regexp "$(printf '^rancher/rancher[ \t]+')"
    curl --insecure --silent --show-error "https://localhost:8443/dashboard/auth/login"
    assert_failure
}

@test 'verify busybox is gone after downgrade' {
    verify_busybox_gone
}
verify_busybox_gone() {
    run kubectl_exe get pods -A | grep  busybox- | wc -l
    assert_output 0
}

teardown_file() {
    load '../helpers/load'

    run ctrctl rm -f nginx

    run helm uninstall wordpress --wait
    # The database PVC doesn't get deleted by `helm uninstall`.
    run kubectl delete pvc data-wordpress-mariadb-0
}
