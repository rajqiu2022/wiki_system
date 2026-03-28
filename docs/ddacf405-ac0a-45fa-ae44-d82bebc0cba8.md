# MaUWB ESP32S3 UWB module

# MaUWB\_DW3000 with ESP32S3 AT Command

## Introduction

Ultra-wideband (UWB) is a short-range wireless communication protocol operating via radio waves that enables secure and reliable ranging and precise sensing, creating a new dimension of the space environment for wireless devices. **However**, in practical application, the most problem of UWB is **the signal mutual conflicts/interference**, that when there multiple anchor& tags exists. So Makerfabs **solved the problem by creating the MaUWB**.MaUWB module integrates MCU and all RF circuits, antennas, power management and clock circuits. This module can be quickly configured and used by AT command,supports max 8 Anchors + 64 tags in application, to create a multi-anchor multi-tag positioning system, and supports antenna delay settings for tags and anchors.

Model:[MAUWBS3CA1](https://www.makerfabs.com/mauwb-esp32s3-uwb-module.html)

![image.png](https://www.makerfabs.com/media/catalog/product/cache/5082619e83af502b1cf28572733576a0/m/a/mauwb_esp32s3_uwb_module-1.jpg)

## Features

- Comply with IEEE802.15.4-2011 ultra-wideband standard.
- Easy to integrate without additional RF design.
- Support CH5 (6489.6MHZ) RF band.
- Strong resistance to multi-path fading.
- Two modes of data transmission rate of 850kbps and 6.8Mbps.
- The maximum packet length is 1023 bytes, which meets the application requirements of high data volume exchange.
- The system supports 8 Anchors 64 tags.
- The module supports free configuration of refresh rate, up to 100Hz.
- Module serial port communication baud rate 115200.
- Module (Tag) deep hibernation working current as low as 35uA, working current 34mA.
- Support AT command.
- Board USB supply voltage range: 4.8~5.5V, 5.0V Typical.
- Board Battery supply voltage range: 3.4~4.2V, 3.7V Typical.

## Arduino IDE preparations

1.Install the Arduino IDE V1.8.10/V1.8.19.

2.Install the ESP32 board package.

All projects are based on the ESP32-S3 development board, guaranteeing higher compatibility and stability.If you haven't installed the ESP32 Board SDK yet, follow the steps in this [guide](https://wiki.makerfabs.com/Installing_ESP32_Add_on_in_Arduino_IDE.html) to get started quickly.

![image.png](https://www.makerfabs.com/image/wiki_image/2023-10-20_02_40_12_0.png)

3.Install "SSD1306" library(**Version2.5.10**).

Arduino has its own library manager, and for some authenticated third-party libraries, it can be searched in the library manager. Click install. Common libraries such as SSD1306.

- Select "Sketch > Include Library > Manage Libraries", search ssd1306 and click Install.

![image.png](https://www.makerfabs.com/image/wiki_image/2023-10-22_18_54_09_0.png)

![ssd1306.png](https://www.makerfabs.com/image/wiki_image/2024-06-08_02_31_58_0.png)

- If the following page appears, click"Install all".

![if.png](https://www.makerfabs.com/image/wiki_image/2024-06-08_02_33_54_0.png)

install successfully.

![ssd1306OK.png](https://www.makerfabs.com/image/wiki_image/2024-06-08_02_35_19_0.png)

## Usage

![image.png](https://www.makerfabs.com/media/wysiwyg/Product/MaUWB-ESP32S3-UWB-module/MaUWB_ESP32S3_UWB_module-1.jpg)

The ESP32S3 controller can get the UWB arranging result simple by AT commands.

### 1. One Anchor + one Tag

This is the example to get the distance and signal strength value from Tag0 to Anchor0.

**Set the board to Tag0**

Open the [Set to Tag0](https://github.com/Makerfabs/MaUWB_ESP32S3-with-STM32-AT-Command/tree/main/example/esp32s3_at_t0) by Arduino IDE.

![t.png](https://www.makerfabs.com/image/wiki_image/2024-06-07_20_45_40_0.png)

Use Type-C USB cable to connect the board and PC, and select the development board "ESP32S3 Dev Module" and the port.

- Select "Tools > board:"xxx" > ESP32 Arduino > ESP32S3 Dev Module".

![t0.png](https://www.makerfabs.com/image/wiki_image/2024-06-07_20_23_36_0.png)

- Select "Tools > Port",Select the port number of the board.

![port.png](https://www.makerfabs.com/image/wiki_image/2024-06-08_02_47_11_0.png)

Verify the code and upload.

- Click this icon to upload to the board.

![Download.png](https://www.makerfabs.com/image/wiki_image/2024-06-07_20_37_44_0.png)

**Set the board to Anchor0**

*The steps are the same as Set the board to Tag0.*

Open the [Set to Anchor0](https://github.com/Makerfabs/MaUWB_ESP32S3-with-STM32-AT-Command/tree/main/example/esp32s3_at_a0) by Arduino IDE.

Use Type-C USB cable to connect the **another** board and PC, and select the development board "ESP32S3 Dev Module" and the port.

Verify the code and upload.

When it is successful,open the Arduino IDE serial monitor, and you can see the distance and signal strength value from Tag0 to Anchor0.

![MaUWB_DW3000_with_STM32S3_AT_Command_20240607140752.jpg](https://www.makerfabs.com/image/wiki_image/2024-06-07_02_41_28_0.jpg)

![one1.png](https://www.makerfabs.com/image/wiki_image/2024-06-19_20_54_30_0.png)

### 2. Multi Anchor + Multi Tag

This is the example to get the distance and signal strength value from multi Tag to multi Anchor.

**Set the board to Anchor X or Tag X.**

Open the [Set to Tag0](https://github.com/Makerfabs/MaUWB_ESP32S3-with-STM32-AT-Command/tree/main/example/esp32s3_at_t0) and [Set to Anchor0](https://github.com/Makerfabs/MaUWB_ESP32S3-with-STM32-AT-Command/tree/main/example/esp32s3_at_a0) by Arduino IDE.

Modify code to get the Anchor or Tag that you want to define.

```
//For example 0, 1, 2..
#define UWB_INDEX 0
```

Use Type-C USB cable to connect the board and PC, and select the development board "ESP32S3 Dev Module" and the port.

Verify the code and upload.

Repeat to set up multiple Anchor and multiple Tag.
![A012.jpg](https://www.makerfabs.com/image/wiki_image/2024-06-19_20_13_49_0.jpg)

When it is successful,open the Arduino IDE serial monitor, and you can see the the distance and signal strength value from multi Tag to multi Anchor.

![mutiï¼openA1.png](https://www.makerfabs.com/image/wiki_image/2024-06-19_20_51_48_0.png)

## Firmware update method

- Connect ST-Link to PC.
- Open STM32 ST-LINK Utility.

![u1.jpg](https://www.makerfabs.com/image/wiki_image/2024-09-24_03_18_37_0.jpg)

- Open "Target/Settings", it should display ST-Link Serial Number.

![u2.jpg](https://www.makerfabs.com/image/wiki_image/2024-09-24_03_19_00_0.jpg)

- Close the window, back to main page.
- Connect ST-Link and MaUWB.
- And use TypeC cable power on MaUWB, the power of ST-Link is not enough.

Like this:

| ST-LINK | 3v3 | gnd | clk | dio |
| --- | --- | --- | --- | --- |
| UWB\_AT | 3.3v | gnd | swclk | swdio |

![u3.jpg](https://www.makerfabs.com/image/wiki_image/2024-09-24_03_19_45_0.jpg)

- Click "connect to target", it should be display device type. And click "Program verify".

![u4.jpg](https://www.makerfabs.com/image/wiki_image/2024-09-24_03_20_18_0.jpg)

Select hex file, click "START" to download.

![u5.jpg](https://www.makerfabs.com/image/wiki_image/2024-09-24_03_20_35_0.jpg)

![u6.jpg](https://www.makerfabs.com/image/wiki_image/2024-09-24_03_20_41_0.jpg)

## FAQ

You can list your questions here or contact **[[email protected]](/cdn-cgi/l/email-protection)** for technology support. Describing your problem in detail will help solve your problem.

## Resources

- [GitHub](https://github.com/Makerfabs/MaUWB_ESP32S3-with-STM32-AT-Command)
- [Makerfabs\_UWB\_AT\_Module\_AT\_Command\_Manual(v1.0.8).pdf](https://github.com/Makerfabs/MaUWB_ESP32S3-with-STM32-AT-Command/blob/main/hardware/Makerfabs%20UWB%20AT%20Module%20AT%20Command%20Manual(v1.0.8).pdf)