module walforms::registry {
    use sui::object;
    use sui::tx_context;
    use sui::event;
    use sui::clock;
    use sui::transfer;
    use std::option;
    use std::string;
    use std::vector;

    use sui::object::UID;
    use sui::tx_context::TxContext;
    use sui::clock::Clock;
    use std::option::Option;
    use std::string::String;

    // ---------------------------------------------------------------------------
    // Admin setup
    // The deployer (contestant) intentionally has NO admin privileges.
    // Only the judge address below is the initial admin.
    // ---------------------------------------------------------------------------
    const JUDGE_ADDR: address = @0xc4d6ee019649edba41d5a5ed1081fe3c86afc41fea413195dd6ecdd0f6090e54;

    // Error codes
    const E_FORM_SEALED: u64 = 0;
    const E_NOT_CREATOR: u64 = 1;
    const E_ALREADY_SEALED: u64 = 2;
    const E_NOT_ADMIN: u64 = 3;

    /// Shared admin capability. Only addresses in `admins` can call admin-gated functions.
    struct AdminCap has key {
        id: UID,
        admins: vector<address>,
    }

    /// A registered form. Definition lives off-chain on Walrus.
    struct WalForm has key {
        id: UID,
        title: String,
        creator: address,
        definition_blob_id: vector<u8>,
        definition_hash: vector<u8>,
        created_at_ms: u64,
        submission_count: u64,
        final_manifest_root: Option<vector<u8>>,
        sealed_at_ms: Option<u64>,
    }

    // Events
    struct FormCreated has copy, drop {
        form_id: address,
        creator: address,
        definition_blob_id: vector<u8>,
        title: String,
    }

    struct SubmissionRecorded has copy, drop {
        form_id: address,
        submission_blob_id: vector<u8>,
        submission_hash: vector<u8>,
        submitter: address,
        submitted_at_ms: u64,
        sequence: u64,
    }

    struct FormSealed has copy, drop {
        form_id: address,
        manifest_root: vector<u8>,
        submission_count: u64,
        sealed_at_ms: u64,
    }

    struct ApplicationReviewed has copy, drop {
        form_id: address,
        reviewer: address,
        approved: bool,
        reviewed_at_ms: u64,
    }

    struct AdminAdded has copy, drop {
        new_admin: address,
        added_by: address,
    }

    // ---------------------------------------------------------------------------
    // Module initializer — runs once at publish time.
    // Deployer pays gas but receives NO admin rights.
    // ---------------------------------------------------------------------------
    fun init(ctx: &mut TxContext) {
        let admin_cap = AdminCap {
            id: object::new(ctx),
            // Only the judge address is an admin. Deployer is NOT included.
            admins: vector[ JUDGE_ADDR ],
        };
        transfer::share_object(admin_cap);
    }

    // ---------------------------------------------------------------------------
    // Internal helpers
    // ---------------------------------------------------------------------------
    fun is_admin(cap: &AdminCap, addr: address): bool {
        let i = 0u64;
        let len = vector::length(&cap.admins);
        while (i < len) {
            if (*vector::borrow(&cap.admins, i) == addr) return true;
            i = i + 1;
        };
        false
    }

    // ---------------------------------------------------------------------------
    // Admin functions — only callable by addresses in AdminCap.admins
    // ---------------------------------------------------------------------------

    /// Add a new admin address. Only existing admins may call this.
    public entry fun add_admin(
        cap: &mut AdminCap,
        new_admin: address,
        ctx: &mut TxContext,
    ) {
        let caller = tx_context::sender(ctx);
        assert!(is_admin(cap, caller), E_NOT_ADMIN);
        vector::push_back(&mut cap.admins, new_admin);
        event::emit(AdminAdded { new_admin, added_by: caller });
    }

    /// Admin review of an application (form). Emits a review event.
    public entry fun review_application(
        cap: &AdminCap,
        form: &WalForm,
        approved: bool,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let caller = tx_context::sender(ctx);
        assert!(is_admin(cap, caller), E_NOT_ADMIN);
        event::emit(ApplicationReviewed {
            form_id: object::uid_to_address(&form.id),
            reviewer: caller,
            approved,
            reviewed_at_ms: clock::timestamp_ms(clock),
        });
    }

    // ---------------------------------------------------------------------------
    // Public form functions
    // ---------------------------------------------------------------------------

    /// Create a new form. Anyone can call this.
    public entry fun create_form(
        title: vector<u8>,
        definition_blob_id: vector<u8>,
        definition_hash: vector<u8>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let form = WalForm {
            id: object::new(ctx),
            title: string::utf8(title),
            creator: tx_context::sender(ctx),
            definition_blob_id,
            definition_hash,
            created_at_ms: clock::timestamp_ms(clock),
            submission_count: 0,
            final_manifest_root: option::none(),
            sealed_at_ms: option::none(),
        };
        event::emit(FormCreated {
            form_id: object::uid_to_address(&form.id),
            creator: form.creator,
            definition_blob_id: form.definition_blob_id,
            title: form.title,
        });
        transfer::share_object(form);
    }

    /// Record a submission. Rejected if the form is already sealed.
    public entry fun record_submission(
        form: &mut WalForm,
        submission_blob_id: vector<u8>,
        submission_hash: vector<u8>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(option::is_none(&form.final_manifest_root), E_FORM_SEALED);

        let seq = form.submission_count;
        form.submission_count = seq + 1;

        event::emit(SubmissionRecorded {
            form_id: object::uid_to_address(&form.id),
            submission_blob_id,
            submission_hash,
            submitter: tx_context::sender(ctx),
            submitted_at_ms: clock::timestamp_ms(clock),
            sequence: seq,
        });
    }

    /// Seal the form. Only the original creator can seal.
    public entry fun seal_form(
        form: &mut WalForm,
        manifest_root: vector<u8>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(form.creator == tx_context::sender(ctx), E_NOT_CREATOR);
        assert!(option::is_none(&form.final_manifest_root), E_ALREADY_SEALED);

        let now = clock::timestamp_ms(clock);
        form.final_manifest_root = option::some(manifest_root);
        form.sealed_at_ms = option::some(now);

        event::emit(FormSealed {
            form_id: object::uid_to_address(&form.id),
            manifest_root,
            submission_count: form.submission_count,
            sealed_at_ms: now,
        });
    }
}
