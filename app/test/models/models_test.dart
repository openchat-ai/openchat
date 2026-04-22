import 'package:flutter_test/flutter_test.dart';
import 'package:openchat/models/user_identity.dart';
import 'package:openchat/models/conversation.dart';
import 'package:openchat/models/message.dart';
import 'package:openchat/models/channel.dart';

void main() {
  group('Identity', () {
    test('创建身份', () async {
      final identity = await Identity.create(name: 'Test User');

      expect(identity.name, 'Test User');
      expect(identity.id.length, 16);
    });

    test('copyWith 更新状态', () async {
      final identity = await Identity.create(name: 'User');

      final updated = identity.copyWith(isOnline: false);

      expect(updated.isOnline, false);
      expect(updated.name, 'User');
    });
  });

  group('Conversation', () {
    test('创建会话', () {
      final conversation = Conversation(
        peerId: 'peer-1',
        lastMessage: 'Hello',
        lastMessageTime: DateTime(2024, 1, 1),
        unreadCount: 2,
      );

      expect(conversation.peerId, 'peer-1');
      expect(conversation.lastMessage, 'Hello');
      expect(conversation.unreadCount, 2);
    });

    test('会话默认值', () {
      final conversation = Conversation(
        peerId: 'peer-2',
        lastMessage: 'Test',
        lastMessageTime: DateTime.now(),
      );

      expect(conversation.unreadCount, 0);
    });

    test('会话排序', () {
      final conv1 = Conversation(
        peerId: 'peer-1',
        lastMessage: 'Hi',
        lastMessageTime: DateTime(2024, 1, 1),
      );

      final conv2 = Conversation(
        peerId: 'peer-2',
        lastMessage: 'Hello',
        lastMessageTime: DateTime(2024, 1, 2),
      );

      final list = [conv1, conv2]
        ..sort((a, b) => b.lastMessageTime.compareTo(a.lastMessageTime));

      expect(list.first.peerId, 'peer-2');
    });
  });

  group('Message', () {
    test('创建消息', () {
      final message = Message(
        id: 'msg-1',
        senderId: 'user-1',
        receiverId: 'user-2',
        content: 'Hello World',
        timestamp: DateTime(2024, 1, 1),
      );

      expect(message.id, 'msg-1');
      expect(message.content, 'Hello World');
      expect(message.isRead, false);
    });

    test('消息标记已读', () {
      final message = Message(
        id: 'msg-1',
        senderId: 'user-1',
        receiverId: 'user-2',
        content: 'Test',
        timestamp: DateTime.now(),
        isRead: false,
      );

      final read = message.copyWith(isRead: true);

      expect(read.isRead, true);
    });

    test('消息类型默认为 text', () {
      final message = Message(
        id: 'msg-2',
        senderId: 'user-1',
        receiverId: 'user-2',
        content: 'Test',
        timestamp: DateTime.now(),
      );

      expect(message.type, 'text');
    });
  });

  group('Channel', () {
    test('创建群组频道', () {
      final channel = Channel.createGroup(
        name: 'General',
        description: 'General discussion',
        creatorId: 'user-1',
      );

      expect(channel.name, 'General');
      expect(channel.type, ChannelType.group);
      expect(channel.creatorId, 'user-1');
    });

    test('创建广播频道', () {
      final channel = Channel.createBroadcast(
        name: 'Announcements',
        creatorId: 'user-1',
      );

      expect(channel.name, 'Announcements');
      expect(channel.type, ChannelType.broadcast);
    });

    test('频道成员检查', () {
      final channel = Channel.createGroup(
        name: 'Test Group',
        creatorId: 'user-1',
        memberIds: ['user-1', 'user-2'],
      );

      expect(channel.isMember('user-1'), true);
      expect(channel.isMember('user-2'), true);
      expect(channel.isMember('user-3'), false);
    });

    test('频道管理员检查', () {
      final channel = Channel.createGroup(
        name: 'Test Group',
        creatorId: 'user-1',
      );

      expect(channel.isAdmin('user-1'), true);
      expect(channel.isCreator('user-1'), true);
    });
  });

  group('ChannelMessage', () {
    test('创建频道消息', () {
      final message = ChannelMessage.create(
        channelId: 'channel-1',
        senderId: 'user-1',
        senderName: 'User',
        content: 'Hello everyone!',
      );

      expect(message.channelId, 'channel-1');
      expect(message.senderId, 'user-1');
      expect(message.content, 'Hello everyone!');
      expect(message.type, MessageType.text);
    });
  });
}
