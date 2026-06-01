import 'dart:io';
import 'dart:convert';
import 'package:device_info_plus/device_info_plus.dart';
import 'package:battery_plus/battery_plus.dart';
import 'package:connectivity_plus/connectivity_plus.dart';

/// 设备能力信息
class DeviceCapability {
  final String deviceId;
  final String deviceName;
  final String type;
  final double totalTOPS;
  final double memoryGB;
  final String powerStatus;
  final bool isCharging;
  final int batteryLevel;
  final String networkType;
  final DateTime timestamp;

  DeviceCapability({
    required this.deviceId,
    required this.deviceName,
    required this.type,
    required this.totalTOPS,
    required this.memoryGB,
    required this.powerStatus,
    required this.isCharging,
    required this.batteryLevel,
    required this.networkType,
    required this.timestamp,
  });

  Map<String, dynamic> toJson() => {
    'deviceId': deviceId,
    'deviceName': deviceName,
    'type': type,
    'totalTOPS': totalTOPS,
    'memoryGB': memoryGB,
    'powerStatus': powerStatus,
    'isCharging': isCharging,
    'batteryLevel': batteryLevel,
    'networkType': networkType,
    'timestamp': timestamp.toIso8601String(),
  };

  factory DeviceCapability.fromJson(Map<String, dynamic> json) {
    return DeviceCapability(
      deviceId: json['deviceId'],
      deviceName: json['deviceName'],
      type: json['type'],
      totalTOPS: (json['totalTOPS'] as num).toDouble(),
      memoryGB: (json['memoryGB'] as num).toDouble(),
      powerStatus: json['powerStatus'],
      isCharging: json['isCharging'] ?? false,
      batteryLevel: json['batteryLevel'] ?? 100,
      networkType: json['networkType'] ?? 'unknown',
      timestamp: DateTime.parse(json['timestamp']),
    );
  }
}

/// 设备算力检测器
class DeviceCapabilityDetector {
  final DeviceInfoPlugin _deviceInfo = DeviceInfoPlugin();
  final Battery _battery = Battery();
  final Connectivity _connectivity = Connectivity();

  String? _cachedDeviceId;
  String? _cachedDeviceName;

  /// 检测设备算�?  Future<DeviceCapability> detectCapability() async {
    // 获取设备信息
    final deviceInfo = await _getDeviceInfo();

    // 获取电池状�?    final batteryInfo = await _getBatteryInfo();

    // 获取网络状�?    final networkInfo = await _getNetworkInfo();

    // 获取硬件算力评估
    final hardwareInfo = _evaluateHardware(deviceInfo);

    // 确定电量状�?    final powerStatus = _determinePowerStatus(
      batteryInfo['level'],
      batteryInfo['isCharging'],
    );

    return DeviceCapability(
      deviceId: deviceInfo['deviceId'] ?? 'unknown',
      deviceName: deviceInfo['deviceName'] ?? 'Unknown',
      type: 'mobile',
      totalTOPS: hardwareInfo['totalTOPS'],
      memoryGB: hardwareInfo['memoryGB'],
      powerStatus: powerStatus,
      isCharging: batteryInfo['isCharging'],
      batteryLevel: batteryInfo['level'],
      networkType: networkInfo,
      timestamp: DateTime.now(),
    );
  }

  /// 获取设备基本信息
  Future<Map<String, dynamic>> _getDeviceInfo() async {
    String deviceId;
    String deviceName;

    if (Platform.isAndroid) {
      final info = await _deviceInfo.androidInfo;
      deviceId = '${info.id}${info.fingerprint}';
      deviceName = '${info.manufacturer} ${info.model}';
      _cachedDeviceId = deviceId;
      _cachedDeviceName = deviceName;
    } else if (Platform.isIOS) {
      final info = await _deviceInfo.iosInfo;
      deviceId = info.identifierForVendor ?? info.name;
      deviceName = info.utsname.machine;
      _cachedDeviceId = deviceId;
      _cachedDeviceName = deviceName;
    } else {
      deviceId = _cachedDeviceId ?? 'unknown';
      deviceName = _cachedDeviceName ?? 'Unknown Device';
    }

    return {
      'deviceId': deviceId,
      'deviceName': deviceName,
    };
  }

  /// 获取电池信息
  Future<Map<String, dynamic>> _getBatteryInfo() async {
    try {
      final level = await _battery.batteryLevel;
      final state = await _battery.batteryState;

      return {
        'level': level,
        'isCharging': state == BatteryState.charging ||
                      state == BatteryState.full,
      };
    } catch (e) {
      return {'level': 100, 'isCharging': true};
    }
  }

  /// 获取网络信息
  Future<String> _getNetworkInfo() async {
    try {
      final result = await _connectivity.checkConnectivity();
      if (result.contains(ConnectivityResult.wifi)) {
        return 'wifi';
      } else if (result.contains(ConnectivityResult.mobile)) {
        return 'mobile';
      } else {
        return 'none';
      }
    } catch (e) {
      return 'unknown';
    }
  }

  /// 评估硬件算力
  Map<String, dynamic> _evaluateHardware(Map<String, dynamic> deviceInfo) {
    // 基于设备型号估算算力
    // 实际应该用更精确的方�?
    final name = (deviceInfo['deviceName'] ?? '').toLowerCase();

    // 估算 NPU TOPS (基于常见手机芯片)
    double npuTOPS;
    if (name.contains('iphone 15') || name.contains('iphone 16')) {
      npuTOPS = 35; // A17 Pro
    } else if (name.contains('snapdragon 8 gen 3')) {
      npuTOPS = 45; // Snapdragon 8 Gen 3
    } else if (name.contains('snapdragon 8 gen 2')) {
      npuTOPS = 27; // Snapdragon 8 Gen 2
    } else if (name.contains('tensor')) {
      npuTOPS = 17; // Google Tensor
    } else if (name.contains('iphone 14')) {
      npuTOPS = 17; // A16
    } else if (name.contains('iphone 13')) {
      npuTOPS = 15; // A15
    } else if (name.contains('pixel')) {
      npuTOPS = 15;
    } else if (name.contains('samsung') || name.contains('galaxy')) {
      npuTOPS = 15;
    } else {
      // 默认保守估计
      npuTOPS = 10;
    }

    // 估算内存 (GB)
    double memoryGB;
    if (Platform.isIOS) {
      // iOS 设备内存相对固定
      if (name.contains('pro max') || name.contains('plus')) {
        memoryGB = 8;
      } else if (name.contains('pro')) {
        memoryGB = 8;
      } else {
        memoryGB = 6;
      }
    } else {
      // Android 差异较大，保守估�?      memoryGB = 8;
    }

    return {
      'totalTOPS': npuTOPS,
      'memoryGB': memoryGB,
      'npuTOPS': npuTOPS,
      'estimated': true,
    };
  }

  /// 确定电量状�?  String _determinePowerStatus(int batteryLevel, bool isCharging) {
    if (isCharging) {
      return 'charging';
    } else if (batteryLevel > 50) {
      return 'normal';
    } else if (batteryLevel > 20) {
      return 'normal';
    } else {
      return 'low';
    }
  }

  /// 获取算力等级
  String getCapabilityLevel(DeviceCapability device) {
    final tops = device.totalTOPS;
    final battery = device.batteryLevel;

    if (tops >= 50) return 'ultra';
    if (tops >= 30) return 'strong';
    if (tops >= 10) return 'normal';
    return 'weak';
  }

  /// 获取推荐传输方案
  Map<String, dynamic> getRecommendedScheme(DeviceCapability device) {
    final level = getCapabilityLevel(device);

    // 基于算力和电量选择
    if (device.powerStatus == 'low' || device.batteryLevel < 20) {
      return {
        'scheme': 'lmdn_low',
        'reason': 'Low battery, using power-saving mode',
        'bitrate': 16,
      };
    }

    switch (level) {
      case 'ultra':
        return {
          'scheme': 'neural',
          'reason': 'Strong NPU, using neural codec',
          'bitrate': 32,
        };
      case 'strong':
        return {
          'scheme': 'neural',
          'reason': 'Good NPU, using neural codec',
          'bitrate': 16,
        };
      case 'normal':
        return {
          'scheme': 'lmdn_high',
          'reason': 'Moderate NPU, using LMDN',
          'bitrate': 64,
        };
      default:
        return {
          'scheme': 'lmdn_low',
          'reason': 'Weak NPU, using low-power mode',
          'bitrate': 16,
        };
    }
  }
}
