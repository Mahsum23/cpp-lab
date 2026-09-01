#include <sys/socket.h>
#include <cstdio>
#include <cerrno>
#include <cstring>

int main() {
    int fd = socket(AF_INET, SOCK_STREAM, 0);
    if (fd < 0) {
        printf("%s", strerror(errno));
    } else {
        printf("returned fd is %i", fd);
    }
}