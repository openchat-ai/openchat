import 'package:flutter_test/flutter_test.dart';
import 'package:openchat/core/voice/voice_service.dart';

void main() {
  group('VoiceServiceConfig', () {
    test('默认配置正确', () {
      const config = VoiceServiceConfig.default_;

      expect(config.mode, VoiceMode.pushToTalk);
      expect(config.voiceActivityThreshold, 0.02);
      expect(config.vadSilenceDelay, 500);
      expect(config.enableNoiseSuppression, true);
      expect(config.enableEchoCancellation, true);
      expect(config.enableAutoGain, true);
    });

    test('游戏配置正确', () {
      const config = VoiceServiceConfig.gaming;

      expect(config.mode, VoiceMode.pushToTalk);
      expect(config.vadSilenceDelay, 200);
    });

    test('会议配置正确', () {
      const config = VoiceServiceConfig.meeting;

      expect(config.mode, VoiceMode.voiceActivity);
      expect(config.voiceActivityThreshold, 0.015);
    });
  });

  group('VoiceMember', () {
    test('创建成员', () {
      final member = VoiceMember(
        id: 'user-1',
        name: 'Test User',
        avatar: 'avatar.png',
      );

      expect(member.id, 'user-1');
      expect(member.name, 'Test User');
      expect(member.isMuted, false);
      expect(member.isDeafen, false);
      expect(member.isSpeaking, false);
      expect(member.volume, 1.0);
    });

    test('成员默认值', () {
      final member = VoiceMember(id: 'user-2', name: 'User');

      expect(member.avatar, isNull);
      expect(member.isMuted, false);
      expect(member.volume, 1.0);
    });
  });

  group('VoiceRoom', () {
    test('创建房间', () {
      final room = VoiceRoom(
        id: 'room-1',
        name: 'Test Room',
        maxMembers: 5,
      );

      expect(room.id, 'room-1');
      expect(room.name, 'Test Room');
      expect(room.maxMembers, 5);
      expect(room.members, isEmpty);
    });

    test('房间默认成员数', () {
      final room = VoiceRoom(id: 'room-2', name: 'Room');

      expect(room.maxMembers, 10); // 默认最大成员数
    });
  });

  group('VoiceState 枚举', () {
    test('包含所有状态', () {
      expect(VoiceState.values, contains(VoiceState.idle));
      expect(VoiceState.values, contains(VoiceState.connecting));
      expect(VoiceState.values, contains(VoiceState.connected));
      expect(VoiceState.values, contains(VoiceState.speaking));
      expect(VoiceState.values, contains(VoiceState.muted));
      expect(VoiceState.values, contains(VoiceState.deafen));
      expect(VoiceState.values, contains(VoiceState.error));
    });
  });

  group('VoiceMode 枚举', () {
    test('包含所有模式', () {
      expect(VoiceMode.values, contains(VoiceMode.pushToTalk));
      expect(VoiceMode.values, contains(VoiceMode.voiceActivity));
      expect(VoiceMode.values, contains(VoiceMode.alwaysOn));
    });
  });
}
