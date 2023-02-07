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

@test 'verify wordpress was deployed' {
    verify_wordpress
}

teardown_file() {
    load '../helpers/load'
    run helm uninstall wordpress --wait
    # The database PVC doesn't get deleted by `helm uninstall`.
    run kubectl delete pvc data-wordpress-mariadb-0
}
