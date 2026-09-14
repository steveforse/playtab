FROM eclipse-temurin:21-jdk AS build
RUN apt-get update && apt-get install -y --no-install-recommends curl python3 python3-pip && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/converter
COPY converter/requirements.txt ./
RUN python3 -m pip install --no-cache-dir --break-system-packages -r requirements.txt
RUN curl -fL --retry 3 https://github.com/helge17/tuxguitar/releases/download/2.1.0/tuxguitar-2.1.0-linux-swt-amd64.tar.gz -o tux.tar.gz \
    && echo 'ca898ac6f151fa2537323209646068f5bb09d72fa6ad0cd08e7055291cb13dd0  tux.tar.gz' | sha256sum -c - \
    && mkdir tux && tar -xzf tux.tar.gz -C tux --strip-components=1 && rm tux.tar.gz
COPY script/TefProbe.java ./
RUN javac -cp 'tux/lib/*:tux/share/plugins/*' TefProbe.java
COPY converter/server.py ./
COPY converter/pdf_recognizer.py ./
USER 10001:10001
EXPOSE 8080
CMD ["python3", "server.py"]
