#include <sys/socket.h>
#include <unistd.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <cstdio>
#include <cerrno>
#include <cstring>

int is_little_endian(void) {
    uint16_t num = 1;
    uint8_t *first_byte = (uint8_t *)&num;
    
    return *first_byte == 1;
}

void print_sockaddr_hex(const struct sockaddr_in *addr) {
    const unsigned char *raw = reinterpret_cast<const unsigned char*>(addr);
    for (unsigned i = 0; i < sizeof(*addr); ++i) {
        printf("0x%02x ", raw[i]);
    }
    printf("\n");
}

int main() {
    int fd = socket(AF_INET, SOCK_STREAM, 0);
    if (fd < 0) {
        printf("%s\n", strerror(errno));
        return 1;
    } else {
        printf("returned fd is %i\n", fd);
    }

    struct sockaddr_in addr;
    std::memset(&addr, 0, sizeof(addr));
    addr.sin_family = AF_INET;
    addr.sin_port = htons(9000);
    if (is_little_endian()) {
        printf("This machine is little endian\n");
    } else {
        printf("This machine is big endian\n");
    }
    printf("addr.sin_port (big endian): %i (hex: 0x%02x)\n", addr.sin_port, addr.sin_port);
    printf("addr.sin_port (little endian): %i (hex: 0x%02x)\n", ntohs(addr.sin_port), ntohs(addr.sin_port));
    addr.sin_addr.s_addr = INADDR_ANY;
    char text[INET_ADDRSTRLEN];
    inet_ntop(AF_INET, &addr.sin_addr, text, sizeof(text));
    printf("inet_ntop: %s\n", text);
    print_sockaddr_hex(&addr);


    close(fd);
    return 0;
}