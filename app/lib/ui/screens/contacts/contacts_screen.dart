import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:openchat/models/user_identity.dart';
import 'package:openchat/providers/contacts_provider.dart';
import 'package:openchat/ui/theme/colors.dart';
import 'package:openchat/ui/screens/scan/scan_screen.dart';

class ContactsScreen extends ConsumerWidget {
  const ContactsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final contacts = ref.watch(contactsProvider);

    return Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      body: CustomScrollView(
        slivers: [
          SliverAppBar(
            floating: true,
            title: const Text('Contacts'),
            actions: [
              IconButton(
                icon: const Icon(Icons.person_add),
                onPressed: () => _showAddOptions(context),
              ),
            ],
          ),
          if (contacts.isEmpty)
            SliverFillRemaining(
              child: Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(
                      Icons.people_outline,
                      size: 64,
                      color: AppColors.textSecondary.withAlpha(128),
                    ),
                    const SizedBox(height: 16),
                    Text(
                      'No contacts yet',
                      style: TextStyle(
                        color: AppColors.textSecondary.withAlpha(128),
                        fontSize: 16,
                      ),
                    ),
                    const SizedBox(height: 24),
                    ElevatedButton.icon(
                      onPressed: () => _showAddOptions(context),
                      icon: const Icon(Icons.person_add),
                      label: const Text('Add Contact'),
                    ),
                  ],
                ),
              ),
            )
          else
            SliverList(
              delegate: SliverChildBuilderDelegate((context, index) {
                final contact = contacts[index];
                return _ContactTile(
                  contact: contact,
                  onTap: () => _openChat(context, contact),
                );
              }, childCount: contacts.length),
            ),
        ],
      ),
    );
  }

  void _showAddOptions(BuildContext context) {
    showModalBottomSheet(
      context: context,
      backgroundColor: AppColors.surfaceDark,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const SizedBox(height: 8),
            Container(
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: AppColors.textSecondary.withAlpha(77),
                borderRadius: BorderRadius.circular(2),
              ),
            ),
            const SizedBox(height: 16),
            ListTile(
              leading: const Icon(
                Icons.qr_code_scanner,
                color: AppColors.primary,
              ),
              title: const Text('Scan QR Code'),
              subtitle: const Text('Add a contact by scanning their QR code'),
              onTap: () {
                Navigator.pop(context);
                Navigator.push(
                  context,
                  MaterialPageRoute(builder: (_) => const ScanScreen()),
                );
              },
            ),
            ListTile(
              leading: const Icon(Icons.link, color: AppColors.secondary),
              title: const Text('Enter Peer ID'),
              subtitle: const Text('Add a contact by entering their Peer ID'),
              onTap: () {
                Navigator.pop(context);
                _showEnterPeerIdDialog(context);
              },
            ),
            ListTile(
              leading: const Icon(Icons.smart_toy, color: AppColors.accent),
              title: const Text('Add AI'),
              subtitle: const Text('Add an AI assistant to your contacts'),
              onTap: () {
                Navigator.pop(context);
                Navigator.pushNamed(context, '/ai/add');
              },
            ),
            const SizedBox(height: 16),
          ],
        ),
      ),
    );
  }

  void _showEnterPeerIdDialog(BuildContext context) {
    final controller = TextEditingController();
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: AppColors.surfaceDark,
        title: const Text('Enter Peer ID'),
        content: TextField(
          controller: controller,
          style: const TextStyle(color: Colors.white),
          decoration: InputDecoration(
            hintText: 'did:key:xxxxx',
            hintStyle: const TextStyle(color: AppColors.textSecondary),
            filled: true,
            fillColor: AppColors.backgroundDark,
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
              borderSide: BorderSide.none,
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: () {
              Navigator.pop(context);
            },
            child: const Text('Add'),
          ),
        ],
      ),
    );
  }

  void _openChat(BuildContext context, Identity contact) {
    Navigator.pushNamed(
      context,
      '/chat',
      arguments: {
        'id': contact.id,
        'name': contact.name,
      },
    );
  }
}

class _ContactTile extends StatelessWidget {
  final Identity contact;
  final VoidCallback onTap;

  const _ContactTile({required this.contact, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return ListTile(
      onTap: onTap,
      leading: CircleAvatar(
        radius: 24,
        backgroundColor: AppColors.primary,
        child: Text(
          contact.name.isNotEmpty ? contact.name[0].toUpperCase() : '?',
          style: const TextStyle(
            color: Colors.white,
            fontWeight: FontWeight.bold,
            fontSize: 18,
          ),
        ),
      ),
      title: Row(
        children: [
          Expanded(
            child: Text(
              contact.name,
              style: const TextStyle(
                fontWeight: FontWeight.w600,
                color: Colors.white,
              ),
            ),
          ),
        ],
      ),
      subtitle: Text(
        contact.id,
        style: const TextStyle(color: AppColors.textSecondary, fontSize: 13),
      ),
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 8,
            height: 8,
            decoration: BoxDecoration(
              color: contact.isOnline
                  ? AppColors.success
                  : AppColors.textSecondary,
              shape: BoxShape.circle,
            ),
          ),
          const SizedBox(width: 8),
          const Icon(Icons.chevron_right, color: AppColors.textSecondary),
        ],
      ),
    );
  }
}
