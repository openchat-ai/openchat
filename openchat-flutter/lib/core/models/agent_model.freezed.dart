// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'agent_model.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

T _$identity<T>(T value) => value;

final _privateConstructorUsedError = UnsupportedError(
  'It seems like you constructed your class using `MyClass._()`. This constructor is only meant to be used by freezed and you are not supposed to need it nor use it.\nPlease check the documentation here for more information: https://github.com/rrousselGit/freezed#adding-getters-and-methods-to-our-models',
);

Agent _$AgentFromJson(Map<String, dynamic> json) {
  return _Agent.fromJson(json);
}

/// @nodoc
mixin _$Agent {
  String get id => throw _privateConstructorUsedError;
  String get role => throw _privateConstructorUsedError;
  String get name => throw _privateConstructorUsedError;
  AgentStatus get status => throw _privateConstructorUsedError;
  DateTime get createdAt => throw _privateConstructorUsedError;
  List<String> get capabilities => throw _privateConstructorUsedError;
  String? get task => throw _privateConstructorUsedError;

  /// Serializes this Agent to a JSON map.
  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;

  /// Create a copy of Agent
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  $AgentCopyWith<Agent> get copyWith => throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $AgentCopyWith<$Res> {
  factory $AgentCopyWith(Agent value, $Res Function(Agent) then) =
      _$AgentCopyWithImpl<$Res, Agent>;
  @useResult
  $Res call({
    String id,
    String role,
    String name,
    AgentStatus status,
    DateTime createdAt,
    List<String> capabilities,
    String? task,
  });
}

/// @nodoc
class _$AgentCopyWithImpl<$Res, $Val extends Agent>
    implements $AgentCopyWith<$Res> {
  _$AgentCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  /// Create a copy of Agent
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? id = null,
    Object? role = null,
    Object? name = null,
    Object? status = null,
    Object? createdAt = null,
    Object? capabilities = null,
    Object? task = freezed,
  }) {
    return _then(
      _value.copyWith(
            id: null == id
                ? _value.id
                : id // ignore: cast_nullable_to_non_nullable
                      as String,
            role: null == role
                ? _value.role
                : role // ignore: cast_nullable_to_non_nullable
                      as String,
            name: null == name
                ? _value.name
                : name // ignore: cast_nullable_to_non_nullable
                      as String,
            status: null == status
                ? _value.status
                : status // ignore: cast_nullable_to_non_nullable
                      as AgentStatus,
            createdAt: null == createdAt
                ? _value.createdAt
                : createdAt // ignore: cast_nullable_to_non_nullable
                      as DateTime,
            capabilities: null == capabilities
                ? _value.capabilities
                : capabilities // ignore: cast_nullable_to_non_nullable
                      as List<String>,
            task: freezed == task
                ? _value.task
                : task // ignore: cast_nullable_to_non_nullable
                      as String?,
          )
          as $Val,
    );
  }
}

/// @nodoc
abstract class _$$AgentImplCopyWith<$Res> implements $AgentCopyWith<$Res> {
  factory _$$AgentImplCopyWith(
    _$AgentImpl value,
    $Res Function(_$AgentImpl) then,
  ) = __$$AgentImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({
    String id,
    String role,
    String name,
    AgentStatus status,
    DateTime createdAt,
    List<String> capabilities,
    String? task,
  });
}

/// @nodoc
class __$$AgentImplCopyWithImpl<$Res>
    extends _$AgentCopyWithImpl<$Res, _$AgentImpl>
    implements _$$AgentImplCopyWith<$Res> {
  __$$AgentImplCopyWithImpl(
    _$AgentImpl _value,
    $Res Function(_$AgentImpl) _then,
  ) : super(_value, _then);

  /// Create a copy of Agent
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? id = null,
    Object? role = null,
    Object? name = null,
    Object? status = null,
    Object? createdAt = null,
    Object? capabilities = null,
    Object? task = freezed,
  }) {
    return _then(
      _$AgentImpl(
        id: null == id
            ? _value.id
            : id // ignore: cast_nullable_to_non_nullable
                  as String,
        role: null == role
            ? _value.role
            : role // ignore: cast_nullable_to_non_nullable
                  as String,
        name: null == name
            ? _value.name
            : name // ignore: cast_nullable_to_non_nullable
                  as String,
        status: null == status
            ? _value.status
            : status // ignore: cast_nullable_to_non_nullable
                  as AgentStatus,
        createdAt: null == createdAt
            ? _value.createdAt
            : createdAt // ignore: cast_nullable_to_non_nullable
                  as DateTime,
        capabilities: null == capabilities
            ? _value._capabilities
            : capabilities // ignore: cast_nullable_to_non_nullable
                  as List<String>,
        task: freezed == task
            ? _value.task
            : task // ignore: cast_nullable_to_non_nullable
                  as String?,
      ),
    );
  }
}

/// @nodoc
@JsonSerializable()
class _$AgentImpl implements _Agent {
  const _$AgentImpl({
    required this.id,
    required this.role,
    required this.name,
    required this.status,
    required this.createdAt,
    final List<String> capabilities = const [],
    this.task,
  }) : _capabilities = capabilities;

  factory _$AgentImpl.fromJson(Map<String, dynamic> json) =>
      _$$AgentImplFromJson(json);

  @override
  final String id;
  @override
  final String role;
  @override
  final String name;
  @override
  final AgentStatus status;
  @override
  final DateTime createdAt;
  final List<String> _capabilities;
  @override
  @JsonKey()
  List<String> get capabilities {
    if (_capabilities is EqualUnmodifiableListView) return _capabilities;
    // ignore: implicit_dynamic_type
    return EqualUnmodifiableListView(_capabilities);
  }

  @override
  final String? task;

  @override
  String toString() {
    return 'Agent(id: $id, role: $role, name: $name, status: $status, createdAt: $createdAt, capabilities: $capabilities, task: $task)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$AgentImpl &&
            (identical(other.id, id) || other.id == id) &&
            (identical(other.role, role) || other.role == role) &&
            (identical(other.name, name) || other.name == name) &&
            (identical(other.status, status) || other.status == status) &&
            (identical(other.createdAt, createdAt) ||
                other.createdAt == createdAt) &&
            const DeepCollectionEquality().equals(
              other._capabilities,
              _capabilities,
            ) &&
            (identical(other.task, task) || other.task == task));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode => Object.hash(
    runtimeType,
    id,
    role,
    name,
    status,
    createdAt,
    const DeepCollectionEquality().hash(_capabilities),
    task,
  );

  /// Create a copy of Agent
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  @pragma('vm:prefer-inline')
  _$$AgentImplCopyWith<_$AgentImpl> get copyWith =>
      __$$AgentImplCopyWithImpl<_$AgentImpl>(this, _$identity);

  @override
  Map<String, dynamic> toJson() {
    return _$$AgentImplToJson(this);
  }
}

abstract class _Agent implements Agent {
  const factory _Agent({
    required final String id,
    required final String role,
    required final String name,
    required final AgentStatus status,
    required final DateTime createdAt,
    final List<String> capabilities,
    final String? task,
  }) = _$AgentImpl;

  factory _Agent.fromJson(Map<String, dynamic> json) = _$AgentImpl.fromJson;

  @override
  String get id;
  @override
  String get role;
  @override
  String get name;
  @override
  AgentStatus get status;
  @override
  DateTime get createdAt;
  @override
  List<String> get capabilities;
  @override
  String? get task;

  /// Create a copy of Agent
  /// with the given fields replaced by the non-null parameter values.
  @override
  @JsonKey(includeFromJson: false, includeToJson: false)
  _$$AgentImplCopyWith<_$AgentImpl> get copyWith =>
      throw _privateConstructorUsedError;
}

AgentFeedback _$AgentFeedbackFromJson(Map<String, dynamic> json) {
  return _AgentFeedback.fromJson(json);
}

/// @nodoc
mixin _$AgentFeedback {
  String get agentId => throw _privateConstructorUsedError;
  List<Finding> get findings => throw _privateConstructorUsedError;
  String get summary => throw _privateConstructorUsedError;
  double get performanceScore => throw _privateConstructorUsedError;

  /// Serializes this AgentFeedback to a JSON map.
  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;

  /// Create a copy of AgentFeedback
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  $AgentFeedbackCopyWith<AgentFeedback> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $AgentFeedbackCopyWith<$Res> {
  factory $AgentFeedbackCopyWith(
    AgentFeedback value,
    $Res Function(AgentFeedback) then,
  ) = _$AgentFeedbackCopyWithImpl<$Res, AgentFeedback>;
  @useResult
  $Res call({
    String agentId,
    List<Finding> findings,
    String summary,
    double performanceScore,
  });
}

/// @nodoc
class _$AgentFeedbackCopyWithImpl<$Res, $Val extends AgentFeedback>
    implements $AgentFeedbackCopyWith<$Res> {
  _$AgentFeedbackCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  /// Create a copy of AgentFeedback
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? agentId = null,
    Object? findings = null,
    Object? summary = null,
    Object? performanceScore = null,
  }) {
    return _then(
      _value.copyWith(
            agentId: null == agentId
                ? _value.agentId
                : agentId // ignore: cast_nullable_to_non_nullable
                      as String,
            findings: null == findings
                ? _value.findings
                : findings // ignore: cast_nullable_to_non_nullable
                      as List<Finding>,
            summary: null == summary
                ? _value.summary
                : summary // ignore: cast_nullable_to_non_nullable
                      as String,
            performanceScore: null == performanceScore
                ? _value.performanceScore
                : performanceScore // ignore: cast_nullable_to_non_nullable
                      as double,
          )
          as $Val,
    );
  }
}

/// @nodoc
abstract class _$$AgentFeedbackImplCopyWith<$Res>
    implements $AgentFeedbackCopyWith<$Res> {
  factory _$$AgentFeedbackImplCopyWith(
    _$AgentFeedbackImpl value,
    $Res Function(_$AgentFeedbackImpl) then,
  ) = __$$AgentFeedbackImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({
    String agentId,
    List<Finding> findings,
    String summary,
    double performanceScore,
  });
}

/// @nodoc
class __$$AgentFeedbackImplCopyWithImpl<$Res>
    extends _$AgentFeedbackCopyWithImpl<$Res, _$AgentFeedbackImpl>
    implements _$$AgentFeedbackImplCopyWith<$Res> {
  __$$AgentFeedbackImplCopyWithImpl(
    _$AgentFeedbackImpl _value,
    $Res Function(_$AgentFeedbackImpl) _then,
  ) : super(_value, _then);

  /// Create a copy of AgentFeedback
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? agentId = null,
    Object? findings = null,
    Object? summary = null,
    Object? performanceScore = null,
  }) {
    return _then(
      _$AgentFeedbackImpl(
        agentId: null == agentId
            ? _value.agentId
            : agentId // ignore: cast_nullable_to_non_nullable
                  as String,
        findings: null == findings
            ? _value._findings
            : findings // ignore: cast_nullable_to_non_nullable
                  as List<Finding>,
        summary: null == summary
            ? _value.summary
            : summary // ignore: cast_nullable_to_non_nullable
                  as String,
        performanceScore: null == performanceScore
            ? _value.performanceScore
            : performanceScore // ignore: cast_nullable_to_non_nullable
                  as double,
      ),
    );
  }
}

/// @nodoc
@JsonSerializable()
class _$AgentFeedbackImpl implements _AgentFeedback {
  const _$AgentFeedbackImpl({
    required this.agentId,
    required final List<Finding> findings,
    required this.summary,
    this.performanceScore = 0.0,
  }) : _findings = findings;

  factory _$AgentFeedbackImpl.fromJson(Map<String, dynamic> json) =>
      _$$AgentFeedbackImplFromJson(json);

  @override
  final String agentId;
  final List<Finding> _findings;
  @override
  List<Finding> get findings {
    if (_findings is EqualUnmodifiableListView) return _findings;
    // ignore: implicit_dynamic_type
    return EqualUnmodifiableListView(_findings);
  }

  @override
  final String summary;
  @override
  @JsonKey()
  final double performanceScore;

  @override
  String toString() {
    return 'AgentFeedback(agentId: $agentId, findings: $findings, summary: $summary, performanceScore: $performanceScore)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$AgentFeedbackImpl &&
            (identical(other.agentId, agentId) || other.agentId == agentId) &&
            const DeepCollectionEquality().equals(other._findings, _findings) &&
            (identical(other.summary, summary) || other.summary == summary) &&
            (identical(other.performanceScore, performanceScore) ||
                other.performanceScore == performanceScore));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode => Object.hash(
    runtimeType,
    agentId,
    const DeepCollectionEquality().hash(_findings),
    summary,
    performanceScore,
  );

  /// Create a copy of AgentFeedback
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  @pragma('vm:prefer-inline')
  _$$AgentFeedbackImplCopyWith<_$AgentFeedbackImpl> get copyWith =>
      __$$AgentFeedbackImplCopyWithImpl<_$AgentFeedbackImpl>(this, _$identity);

  @override
  Map<String, dynamic> toJson() {
    return _$$AgentFeedbackImplToJson(this);
  }
}

abstract class _AgentFeedback implements AgentFeedback {
  const factory _AgentFeedback({
    required final String agentId,
    required final List<Finding> findings,
    required final String summary,
    final double performanceScore,
  }) = _$AgentFeedbackImpl;

  factory _AgentFeedback.fromJson(Map<String, dynamic> json) =
      _$AgentFeedbackImpl.fromJson;

  @override
  String get agentId;
  @override
  List<Finding> get findings;
  @override
  String get summary;
  @override
  double get performanceScore;

  /// Create a copy of AgentFeedback
  /// with the given fields replaced by the non-null parameter values.
  @override
  @JsonKey(includeFromJson: false, includeToJson: false)
  _$$AgentFeedbackImplCopyWith<_$AgentFeedbackImpl> get copyWith =>
      throw _privateConstructorUsedError;
}

Finding _$FindingFromJson(Map<String, dynamic> json) {
  return _Finding.fromJson(json);
}

/// @nodoc
mixin _$Finding {
  String get type => throw _privateConstructorUsedError;
  String get description => throw _privateConstructorUsedError;
  String get location => throw _privateConstructorUsedError;
  String get remediation => throw _privateConstructorUsedError;
  double get confidence => throw _privateConstructorUsedError;

  /// Serializes this Finding to a JSON map.
  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;

  /// Create a copy of Finding
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  $FindingCopyWith<Finding> get copyWith => throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $FindingCopyWith<$Res> {
  factory $FindingCopyWith(Finding value, $Res Function(Finding) then) =
      _$FindingCopyWithImpl<$Res, Finding>;
  @useResult
  $Res call({
    String type,
    String description,
    String location,
    String remediation,
    double confidence,
  });
}

/// @nodoc
class _$FindingCopyWithImpl<$Res, $Val extends Finding>
    implements $FindingCopyWith<$Res> {
  _$FindingCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  /// Create a copy of Finding
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? type = null,
    Object? description = null,
    Object? location = null,
    Object? remediation = null,
    Object? confidence = null,
  }) {
    return _then(
      _value.copyWith(
            type: null == type
                ? _value.type
                : type // ignore: cast_nullable_to_non_nullable
                      as String,
            description: null == description
                ? _value.description
                : description // ignore: cast_nullable_to_non_nullable
                      as String,
            location: null == location
                ? _value.location
                : location // ignore: cast_nullable_to_non_nullable
                      as String,
            remediation: null == remediation
                ? _value.remediation
                : remediation // ignore: cast_nullable_to_non_nullable
                      as String,
            confidence: null == confidence
                ? _value.confidence
                : confidence // ignore: cast_nullable_to_non_nullable
                      as double,
          )
          as $Val,
    );
  }
}

/// @nodoc
abstract class _$$FindingImplCopyWith<$Res> implements $FindingCopyWith<$Res> {
  factory _$$FindingImplCopyWith(
    _$FindingImpl value,
    $Res Function(_$FindingImpl) then,
  ) = __$$FindingImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({
    String type,
    String description,
    String location,
    String remediation,
    double confidence,
  });
}

/// @nodoc
class __$$FindingImplCopyWithImpl<$Res>
    extends _$FindingCopyWithImpl<$Res, _$FindingImpl>
    implements _$$FindingImplCopyWith<$Res> {
  __$$FindingImplCopyWithImpl(
    _$FindingImpl _value,
    $Res Function(_$FindingImpl) _then,
  ) : super(_value, _then);

  /// Create a copy of Finding
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? type = null,
    Object? description = null,
    Object? location = null,
    Object? remediation = null,
    Object? confidence = null,
  }) {
    return _then(
      _$FindingImpl(
        type: null == type
            ? _value.type
            : type // ignore: cast_nullable_to_non_nullable
                  as String,
        description: null == description
            ? _value.description
            : description // ignore: cast_nullable_to_non_nullable
                  as String,
        location: null == location
            ? _value.location
            : location // ignore: cast_nullable_to_non_nullable
                  as String,
        remediation: null == remediation
            ? _value.remediation
            : remediation // ignore: cast_nullable_to_non_nullable
                  as String,
        confidence: null == confidence
            ? _value.confidence
            : confidence // ignore: cast_nullable_to_non_nullable
                  as double,
      ),
    );
  }
}

/// @nodoc
@JsonSerializable()
class _$FindingImpl implements _Finding {
  const _$FindingImpl({
    required this.type,
    required this.description,
    required this.location,
    required this.remediation,
    required this.confidence,
  });

  factory _$FindingImpl.fromJson(Map<String, dynamic> json) =>
      _$$FindingImplFromJson(json);

  @override
  final String type;
  @override
  final String description;
  @override
  final String location;
  @override
  final String remediation;
  @override
  final double confidence;

  @override
  String toString() {
    return 'Finding(type: $type, description: $description, location: $location, remediation: $remediation, confidence: $confidence)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$FindingImpl &&
            (identical(other.type, type) || other.type == type) &&
            (identical(other.description, description) ||
                other.description == description) &&
            (identical(other.location, location) ||
                other.location == location) &&
            (identical(other.remediation, remediation) ||
                other.remediation == remediation) &&
            (identical(other.confidence, confidence) ||
                other.confidence == confidence));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode => Object.hash(
    runtimeType,
    type,
    description,
    location,
    remediation,
    confidence,
  );

  /// Create a copy of Finding
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  @pragma('vm:prefer-inline')
  _$$FindingImplCopyWith<_$FindingImpl> get copyWith =>
      __$$FindingImplCopyWithImpl<_$FindingImpl>(this, _$identity);

  @override
  Map<String, dynamic> toJson() {
    return _$$FindingImplToJson(this);
  }
}

abstract class _Finding implements Finding {
  const factory _Finding({
    required final String type,
    required final String description,
    required final String location,
    required final String remediation,
    required final double confidence,
  }) = _$FindingImpl;

  factory _Finding.fromJson(Map<String, dynamic> json) = _$FindingImpl.fromJson;

  @override
  String get type;
  @override
  String get description;
  @override
  String get location;
  @override
  String get remediation;
  @override
  double get confidence;

  /// Create a copy of Finding
  /// with the given fields replaced by the non-null parameter values.
  @override
  @JsonKey(includeFromJson: false, includeToJson: false)
  _$$FindingImplCopyWith<_$FindingImpl> get copyWith =>
      throw _privateConstructorUsedError;
}
