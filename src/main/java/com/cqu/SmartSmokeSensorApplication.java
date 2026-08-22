package com.cqu;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class SmartSmokeSensorApplication {

    public static void main(String[] args) {
        SpringApplication.run(SmartSmokeSensorApplication.class, args);
    }
}
