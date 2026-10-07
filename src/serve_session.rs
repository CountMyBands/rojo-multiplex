use std::{
    collections::HashSet,
    io,
    net::IpAddr,
    path::Path,
    sync::{Arc, Mutex, MutexGuard},
    time::Instant,
};

use crossbeam_channel::Sender;
use memofs::Vfs;
use thiserror::Error;

use crate::{
    change_processor::ChangeProcessor,
    message_queue::MessageQueue,
    project::{Project, ProjectError},
    session_id::SessionId,
    snapshot::{
        apply_patch_set, compute_patch_set, AppliedPatchSet, InstanceContext, InstanceSnapshot,
        PatchSet, RojoTree,
    },
    snapshot_middleware::snapshot_from_vfs,
};

/// Contains all of the state for a Rojo serve session. A serve session is used
/// when we need to build a Rojo tree and possibly rebuild it when input files
/// change.
///
/// Nothing here is specific to any Rojo interface. Though the primary way to
/// interact with a serve session is Rojo's HTTP right now, there's no reason
/// why Rojo couldn't expose an IPC or channels-based API for embedding in the
/// future. `ServeSession` would be roughly the right interface to expose for
/// those cases.
pub struct ServeSession {
    /// The object responsible for listening to changes from the in-memory
    /// filesystem, applying them, updating the Roblox instance tree, and
    /// routing messages through the session's message queue to any connected
    /// clients.
    ///
    /// SHOULD BE DROPPED FIRST! ServeSession and ChangeProcessor communicate
    /// with eachother via channels. If ServeSession hangs up those channels
    /// before dropping the ChangeProcessor, its thread will panic with a
    /// RecvError, causing the main thread to panic on drop.
    ///
    /// Allowed to be unused because it has side effects when dropped.
    #[allow(unused)]
    change_processor: ChangeProcessor,

    /// When the serve session was started. Used only for user-facing
    /// diagnostics.
    start_time: Instant,

    /// The root project for the serve session.
    ///
    /// This will be defined if a folder with a `default.project.json` file was
    /// used for starting the serve session, or if the user specified a full
    /// path to a `.project.json` file.
    root_project: Project,

    /// A randomly generated ID for this serve session. It's used to ensure that
    /// a client doesn't begin connecting to a different server part way through
    /// an operation that needs to be atomic.
    session_id: SessionId,

    /// The tree of Roblox instances associated with this session that will be
    /// updated in real-time. This is derived from the session's VFS and will
    /// eventually be mutable to connected clients.
    tree: Arc<Mutex<RojoTree>>,

    /// An in-memory filesystem containing all of the files relevant for this
    /// live session.
    ///
    /// The main use for accessing it from the session is for debugging issues
    /// with Rojo's live-sync protocol.
    vfs: Arc<Vfs>,

    /// A queue of changes that have been applied to `tree` that affect clients.
    ///
    /// Clients to the serve session will subscribe to this queue either
    /// directly or through the HTTP API to be notified of mutations that need
    /// to be applied.
    message_queue: Arc<MessageQueue<AppliedPatchSet>>,

    /// A channel to send mutation requests on. These will be handled by the
    /// ChangeProcessor and trigger changes in the tree.
    tree_mutation_sender: Sender<PatchSet>,
}

impl ServeSession {
    /// Start a new serve session from the given in-memory filesystem and start
    /// path.
    ///
    /// The project file is expected to be loaded out-of-band since it's
    /// currently loaded from the filesystem directly instead of through the
    /// in-memory filesystem layer.
    pub fn new<P: AsRef<Path>>(vfs: Vfs, start_path: P) -> Result<Self, ServeSessionError> {
        let start_time = Instant::now();
        let start_path = vfs.canonicalize(start_path.as_ref())?;
        let start_path = start_path.as_path();

        log::trace!("Starting new ServeSession at path {}", start_path.display());

        let root_project = Project::load_initial_project(&vfs, start_path)?;

        let mut tree = RojoTree::new(InstanceSnapshot::new());

        let root_id = tree.get_root_id();

        let instance_context =
            InstanceContext::with_emit_legacy_scripts(root_project.emit_legacy_scripts);

        log::trace!("Generating snapshot of instances from VFS");
        let snapshot = snapshot_from_vfs(&instance_context, &vfs, start_path)?;

        log::trace!("Computing initial patch set");
        let patch_set = compute_patch_set(snapshot, &tree, root_id);

        log::trace!("Applying initial patch set");
        apply_patch_set(&mut tree, patch_set);

        let session_id = SessionId::new();
        let message_queue = MessageQueue::new();

        let tree = Arc::new(Mutex::new(tree));
        let message_queue = Arc::new(message_queue);
        let vfs = Arc::new(vfs);

        let (tree_mutation_sender, tree_mutation_receiver) = crossbeam_channel::unbounded();

        log::trace!("Starting ChangeProcessor");
        let change_processor = ChangeProcessor::start(
            Arc::clone(&tree),
            Arc::clone(&vfs),
            Arc::clone(&message_queue),
            tree_mutation_receiver,
        );

        Ok(Self {
            change_processor,
            start_time,
            session_id,
            root_project,
            tree,
            message_queue,
            tree_mutation_sender,
            vfs,
        })
    }

    pub fn tree_handle(&self) -> Arc<Mutex<RojoTree>> {
        Arc::clone(&self.tree)
    }

    pub fn tree(&self) -> MutexGuard<'_, RojoTree> {
        self.tree.lock().unwrap()
    }

    pub fn tree_mutation_sender(&self) -> Sender<PatchSet> {
        self.tree_mutation_sender.clone()
    }

    #[allow(unused)]
    pub fn vfs(&self) -> &Vfs {
        &self.vfs
    }

    pub fn message_queue(&self) -> &MessageQueue<AppliedPatchSet> {
        &self.message_queue
    }

    pub fn session_id(&self) -> SessionId {
        self.session_id
    }

    pub fn project_name(&self) -> &str {
        self.root_project
            .name
            .as_ref()
            .expect("all top-level projects must have their name set")
    }

    pub fn project_port(&self) -> Option<u16> {
        self.root_project.serve_port
    }

    pub fn place_id(&self) -> Option<u64> {
        self.root_project.place_id
    }

    pub fn game_id(&self) -> Option<u64> {
        self.root_project.game_id
    }

    pub fn start_time(&self) -> Instant {
        self.start_time
    }

    pub fn serve_place_ids(&self) -> Option<&HashSet<u64>> {
        self.root_project.serve_place_ids.as_ref()
    }

    pub fn blocked_place_ids(&self) -> Option<&HashSet<u64>> {
        self.root_project.blocked_place_ids.as_ref()
    }

    pub fn serve_address(&self) -> Option<IpAddr> {
        self.root_project.serve_address
    }

    pub fn serve_allowed_hosts(&self) -> &[String] {
        &self.root_project.serve_allowed_hosts
    }

    pub fn root_dir(&self) -> &Path {
        self.root_project.folder_location()
    }

    pub fn root_project(&self) -> &Project {
        &self.root_project
    }
}

#[derive(Debug, Error)]
pub enum ServeSessionError {
    #[error(transparent)]
    Io {
        #[from]
        source: io::Error,
    },

    #[error(transparent)]
    Project {
        #[from]
        source: ProjectError,
    },

    #[error(transparent)]
    Other {
        #[from]
        source: anyhow::Error,
    },
}

#[cfg(test)]
mod test {
    use super::*;

    use memofs::StdBackend;

    #[test]
    fn tree_is_keyed_by_canonical_paths() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("default.project.json"),
            r#"{ "name": "test", "tree": { "$className": "Folder" } }"#,
        )
        .unwrap();

        // `std::fs::canonicalize` yields a verbatim path on Windows.
        // On other platforms it simply resolves the path (e.g. symlinks),
        // which the session must also handle.
        let start_path = std::fs::canonicalize(dir.path()).unwrap();

        let vfs = Vfs::new(StdBackend::new().unwrap());
        let session = ServeSession::new(vfs, &start_path).unwrap();

        let project_file = start_path.join("default.project.json");
        let canonical = session.vfs().canonicalize(&project_file).unwrap();

        assert!(
            !session.tree().get_ids_at_path(&canonical).is_empty(),
            "project file {} should be tracked in the tree under its canonical \
             path {}, matching what the watcher reports",
            project_file.display(),
            canonical.display(),
        );
    }

    #[cfg(windows)]
    fn source_for_descendant(session: &ServeSession, name: &str) -> Option<String> {
        use rbx_dom_weak::{types::Variant, ustr};

        let tree = session.tree();
        tree.descendants(tree.get_root_id())
            .find(|instance| instance.name() == name)
            .and_then(
                |instance| match instance.properties().get(&ustr("Source")) {
                    Some(Variant::String(source)) => Some(source.clone()),
                    _ => None,
                },
            )
    }

    #[cfg(windows)]
    fn wait_for_tree(
        session: &ServeSession,
        description: &str,
        mut predicate: impl FnMut(&ServeSession) -> bool,
    ) {
        use std::{
            thread,
            time::{Duration, Instant},
        };

        let deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < deadline {
            if predicate(session) {
                return;
            }
            thread::sleep(Duration::from_millis(10));
        }

        panic!("timed out waiting for serve session to {description}");
    }

    #[test]
    #[cfg(windows)]
    fn applies_windows_symlink_updates_without_restarting() {
        use std::os::windows::fs::{symlink_dir, symlink_file};

        let temp = tempfile::tempdir().unwrap();
        let project = temp.path().join("project");
        let source = project.join("src");
        let directory_target_a = temp.path().join("directory-target-a");
        let directory_target_b = temp.path().join("directory-target-b");
        let directory_alias = source.join("linked");
        let file_target = temp.path().join("file-target.lua");
        let file_alias = source.join("file-alias.lua");
        let second_file_alias = source.join("second-file-alias.lua");

        std::fs::create_dir(&project).unwrap();
        std::fs::create_dir(&source).unwrap();
        std::fs::create_dir(&directory_target_a).unwrap();
        std::fs::create_dir(&directory_target_b).unwrap();
        std::fs::write(directory_target_a.join("module.lua"), "return \"initial\"").unwrap();
        std::fs::write(
            directory_target_b.join("replacement.lua"),
            "return \"replacement\"",
        )
        .unwrap();
        std::fs::write(&file_target, "return \"file initial\"").unwrap();
        symlink_dir(&directory_target_a, &directory_alias)
            .expect("this Windows regression test requires permission to create symlinks");
        symlink_file(&file_target, &file_alias).unwrap();
        symlink_file(&file_target, &second_file_alias).unwrap();
        std::fs::write(
            project.join("default.project.json"),
            r#"{ "name": "test", "tree": { "$path": "src" } }"#,
        )
        .unwrap();

        let session = ServeSession::new(Vfs::new(StdBackend::new().unwrap()), &project).unwrap();
        let initial_cursor = session.message_queue().cursor();
        assert_eq!(
            source_for_descendant(&session, "module").as_deref(),
            Some("return \"initial\"")
        );
        assert_eq!(
            source_for_descendant(&session, "file-alias").as_deref(),
            Some("return \"file initial\"")
        );
        assert_eq!(
            source_for_descendant(&session, "second-file-alias").as_deref(),
            Some("return \"file initial\"")
        );

        std::fs::write(directory_target_a.join("module.lua"), "return \"physical\"").unwrap();
        wait_for_tree(&session, "apply a physical-target write", |session| {
            source_for_descendant(session, "module").as_deref() == Some("return \"physical\"")
        });

        std::fs::write(directory_alias.join("module.lua"), "return \"alias\"").unwrap();
        wait_for_tree(&session, "apply an alias-path write", |session| {
            source_for_descendant(session, "module").as_deref() == Some("return \"alias\"")
        });

        std::fs::write(directory_alias.join("created.lua"), "return \"created\"").unwrap();
        wait_for_tree(&session, "add a linked child", |session| {
            source_for_descendant(session, "created").as_deref() == Some("return \"created\"")
        });

        std::fs::rename(
            directory_alias.join("created.lua"),
            directory_alias.join("renamed.lua"),
        )
        .unwrap();
        wait_for_tree(&session, "rename a linked child", |session| {
            source_for_descendant(session, "created").is_none()
                && source_for_descendant(session, "renamed").as_deref()
                    == Some("return \"created\"")
        });

        std::fs::remove_file(directory_alias.join("renamed.lua")).unwrap();
        wait_for_tree(&session, "remove a linked child", |session| {
            source_for_descendant(session, "renamed").is_none()
        });

        std::fs::write(&file_target, "return \"file physical\"").unwrap();
        wait_for_tree(&session, "apply a file-symlink target write", |session| {
            source_for_descendant(session, "file-alias").as_deref()
                == Some("return \"file physical\"")
                && source_for_descendant(session, "second-file-alias").as_deref()
                    == Some("return \"file physical\"")
        });

        std::fs::remove_file(&file_alias).unwrap();
        wait_for_tree(&session, "remove one of two aliases", |session| {
            source_for_descendant(session, "file-alias").is_none()
                && source_for_descendant(session, "second-file-alias").is_some()
        });
        std::fs::write(&file_target, "return \"file still watched\"").unwrap();
        wait_for_tree(
            &session,
            "keep a shared target watched for its remaining alias",
            |session| {
                source_for_descendant(session, "second-file-alias").as_deref()
                    == Some("return \"file still watched\"")
            },
        );

        let replacement_target = temp.path().join("file-target-replacement.lua");
        std::fs::write(&replacement_target, "return \"file replaced\"").unwrap();
        std::fs::remove_file(&file_target).unwrap();
        std::fs::rename(&replacement_target, &file_target).unwrap();
        wait_for_tree(
            &session,
            "apply an atomic-style file target replacement",
            |session| {
                source_for_descendant(session, "second-file-alias").as_deref()
                    == Some("return \"file replaced\"")
            },
        );

        std::fs::remove_file(&file_target).unwrap();
        wait_for_tree(
            &session,
            "remove a file symlink whose target vanished",
            |session| source_for_descendant(session, "second-file-alias").is_none(),
        );
        std::fs::write(&file_target, "return \"file restored\"").unwrap();
        wait_for_tree(&session, "restore a recreated file target", |session| {
            source_for_descendant(session, "second-file-alias").as_deref()
                == Some("return \"file restored\"")
        });

        std::fs::remove_dir(&directory_alias).unwrap();
        wait_for_tree(&session, "remove a directory symlink", |session| {
            source_for_descendant(session, "module").is_none()
        });

        symlink_dir(&directory_target_a, &directory_alias).unwrap();
        wait_for_tree(&session, "recreate a directory symlink", |session| {
            source_for_descendant(session, "module").as_deref() == Some("return \"alias\"")
        });

        std::fs::remove_dir(&directory_alias).unwrap();
        wait_for_tree(
            &session,
            "remove a directory symlink before repointing",
            |session| source_for_descendant(session, "module").is_none(),
        );
        symlink_dir(&directory_target_b, &directory_alias).unwrap();
        wait_for_tree(&session, "repoint a directory symlink", |session| {
            source_for_descendant(session, "replacement").as_deref()
                == Some("return \"replacement\"")
        });

        assert!(
            session.message_queue().cursor() > initial_cursor,
            "serve session should publish applied symlink updates"
        );
    }

    /// Finds an instance by its names from the root, for trees where the same
    /// file is reachable through more than one alias.
    #[cfg(windows)]
    fn source_at(session: &ServeSession, names: &[&str]) -> Option<String> {
        use rbx_dom_weak::{types::Variant, ustr};

        let tree = session.tree();
        let mut instance = tree.get_instance(tree.get_root_id())?;
        for name in names {
            instance = instance
                .children()
                .iter()
                .filter_map(|&child| tree.get_instance(child))
                .find(|child| child.name() == *name)?;
        }
        match instance.properties().get(&ustr("Source")) {
            Some(Variant::String(source)) => Some(source.clone()),
            _ => None,
        }
    }

    /// Mirrors a game repo that shares code through `Shared` and a sibling
    /// `Framework` repo: directory links that chain Game -> Shared ->
    /// Framework, real directories of file links, and links created, moved
    /// and repointed by the sharing scripts while the session is running.
    #[test]
    #[cfg(windows)]
    fn applies_windows_link_creation_and_chains_without_restarting() {
        use std::os::windows::fs::{symlink_dir, symlink_file};

        let temp = tempfile::tempdir().unwrap();
        let framework = temp.path().join("Framework");
        let shared = temp.path().join("Shared");
        let project = temp.path().join("Game");
        let source = project.join("src");

        for dir in [
            framework.join("Anim"),
            framework.join("Audio"),
            shared.join("Settings"),
            source.join("Settings"),
        ] {
            std::fs::create_dir_all(dir).unwrap();
        }
        std::fs::write(framework.join("Anim/Controller.lua"), "return \"anim\"").unwrap();
        std::fs::write(framework.join("Audio/Controller.lua"), "return \"audio\"").unwrap();
        std::fs::write(shared.join("Settings/A.lua"), "return \"a\"").unwrap();
        symlink_dir(framework.join("Anim"), shared.join("Anim"))
            .expect("this Windows regression test requires permission to create symlinks");
        symlink_dir(shared.join("Anim"), source.join("Anim")).unwrap();
        symlink_file(shared.join("Settings/A.lua"), source.join("Settings/A.lua")).unwrap();
        symlink_dir(shared.join("Settings"), source.join("Linked")).unwrap();
        std::fs::write(
            project.join("default.project.json"),
            r#"{ "name": "test", "tree": { "$path": "src" } }"#,
        )
        .unwrap();

        let session = ServeSession::new(Vfs::new(StdBackend::new().unwrap()), &project).unwrap();
        assert_eq!(
            source_at(&session, &["Anim", "Controller"]).as_deref(),
            Some("return \"anim\"")
        );
        assert_eq!(
            source_at(&session, &["Settings", "A"]).as_deref(),
            Some("return \"a\"")
        );

        // (a) Edits behind a two-hop chain.
        std::fs::write(framework.join("Anim/Controller.lua"), "return \"edited\"").unwrap();
        wait_for_tree(&session, "apply an edit behind a link chain", |session| {
            source_at(session, &["Anim", "Controller"]).as_deref() == Some("return \"edited\"")
        });

        // (b) A new file inside a chained directory link's target.
        std::fs::write(framework.join("Anim/Extra.lua"), "return \"extra\"").unwrap();
        wait_for_tree(&session, "add a file behind a link chain", |session| {
            source_at(session, &["Anim", "Extra"]).as_deref() == Some("return \"extra\"")
        });

        // (c) New links: a file link in a real directory, then a directory
        // link to a folder nothing was watching yet.
        std::fs::write(shared.join("Settings/B.lua"), "return \"b\"").unwrap();
        symlink_file(shared.join("Settings/B.lua"), source.join("Settings/B.lua")).unwrap();
        wait_for_tree(&session, "add a new file link", |session| {
            source_at(session, &["Settings", "B"]).as_deref() == Some("return \"b\"")
        });
        std::fs::write(shared.join("Settings/B.lua"), "return \"b edited\"").unwrap();
        wait_for_tree(
            &session,
            "apply an edit to a new link's target",
            |session| {
                source_at(session, &["Settings", "B"]).as_deref() == Some("return \"b edited\"")
            },
        );

        symlink_dir(framework.join("Audio"), source.join("Audio")).unwrap();
        wait_for_tree(&session, "add a new directory link", |session| {
            source_at(session, &["Audio", "Controller"]).as_deref() == Some("return \"audio\"")
        });
        std::fs::write(framework.join("Audio/Added.lua"), "return \"added\"").unwrap();
        wait_for_tree(&session, "add a file to a new directory link", |session| {
            source_at(session, &["Audio", "Added"]).as_deref() == Some("return \"added\"")
        });

        // (c) What Share-Module.ps1 does: move a real file into Shared, then
        // link it back into place.
        std::fs::write(source.join("Settings/Moved.lua"), "return \"moved\"").unwrap();
        wait_for_tree(&session, "add a real file before sharing it", |session| {
            source_at(session, &["Settings", "Moved"]).is_some()
        });
        std::fs::rename(
            source.join("Settings/Moved.lua"),
            shared.join("Settings/Moved.lua"),
        )
        .unwrap();
        symlink_file(
            shared.join("Settings/Moved.lua"),
            source.join("Settings/Moved.lua"),
        )
        .unwrap();
        std::fs::write(shared.join("Settings/Moved.lua"), "return \"shared\"").unwrap();
        wait_for_tree(&session, "follow a file moved into Shared", |session| {
            source_at(session, &["Settings", "Moved"]).as_deref() == Some("return \"shared\"")
                && source_at(session, &["Linked", "Moved"]).as_deref() == Some("return \"shared\"")
        });

        // (d) Removing a target reached through both a file link and a
        // directory link removes both instances, and recreating it restores
        // both.
        std::fs::remove_file(shared.join("Settings/Moved.lua")).unwrap();
        wait_for_tree(&session, "remove a doubly linked target", |session| {
            source_at(session, &["Settings", "Moved"]).is_none()
                && source_at(session, &["Linked", "Moved"]).is_none()
        });
        std::fs::write(shared.join("Settings/Moved.lua"), "return \"restored\"").unwrap();
        wait_for_tree(&session, "restore a doubly linked target", |session| {
            source_at(session, &["Settings", "Moved"]).as_deref() == Some("return \"restored\"")
                && source_at(session, &["Linked", "Moved"]).as_deref()
                    == Some("return \"restored\"")
        });

        // (d) Deleting and renaming links themselves.
        std::fs::remove_file(source.join("Settings/B.lua")).unwrap();
        wait_for_tree(&session, "remove a file link", |session| {
            source_at(session, &["Settings", "B"]).is_none()
                && source_at(session, &["Linked", "B"]).is_some()
        });
        std::fs::rename(
            source.join("Settings/A.lua"),
            source.join("Settings/Renamed.lua"),
        )
        .unwrap();
        wait_for_tree(&session, "rename a file link", |session| {
            source_at(session, &["Settings", "A"]).is_none()
                && source_at(session, &["Settings", "Renamed"]).as_deref() == Some("return \"a\"")
        });
        std::fs::rename(
            framework.join("Anim/Extra.lua"),
            framework.join("Anim/Moved.lua"),
        )
        .unwrap();
        wait_for_tree(&session, "rename a file behind a link chain", |session| {
            source_at(session, &["Anim", "Extra"]).is_none()
                && source_at(session, &["Anim", "Moved"]).as_deref() == Some("return \"extra\"")
        });

        // (d) Repointing the middle link of the chain, which is outside the
        // project, moves where the alias in the project resolves.
        std::fs::remove_dir(shared.join("Anim")).unwrap();
        wait_for_tree(&session, "drop a dangling link chain", |session| {
            source_at(session, &["Anim", "Controller"]).is_none()
        });
        symlink_dir(framework.join("Audio"), shared.join("Anim")).unwrap();
        wait_for_tree(&session, "repoint the middle of a link chain", |session| {
            source_at(session, &["Anim", "Controller"]).as_deref() == Some("return \"audio\"")
                && source_at(session, &["Anim", "Moved"]).is_none()
        });
        std::fs::write(framework.join("Audio/Controller.lua"), "return \"both\"").unwrap();
        wait_for_tree(
            &session,
            "apply an edit behind a repointed chain",
            |session| {
                source_at(session, &["Anim", "Controller"]).as_deref() == Some("return \"both\"")
                    && source_at(session, &["Audio", "Controller"]).as_deref()
                        == Some("return \"both\"")
            },
        );

        std::fs::remove_dir(source.join("Audio")).unwrap();
        wait_for_tree(&session, "remove a directory link", |session| {
            source_at(session, &["Audio", "Controller"]).is_none()
                && source_at(session, &["Anim", "Controller"]).as_deref() == Some("return \"both\"")
        });
    }

    #[test]
    #[cfg(windows)]
    fn applies_windows_junction_updates_without_restarting() {
        let temp = tempfile::tempdir().unwrap();
        let project = temp.path().join("project");
        let source = project.join("src");
        let target = temp.path().join("junction-target");
        let junction = source.join("junctioned");

        std::fs::create_dir(&project).unwrap();
        std::fs::create_dir(&source).unwrap();
        std::fs::create_dir(&target).unwrap();
        std::fs::write(target.join("module.lua"), "return \"initial\"").unwrap();
        // std has no API for junctions; `mklink /J` needs no elevation.
        let status = std::process::Command::new("cmd")
            .arg("/C")
            .arg("mklink")
            .arg("/J")
            .arg(&junction)
            .arg(&target)
            .stdout(std::process::Stdio::null())
            .status()
            .unwrap();
        assert!(status.success(), "mklink /J failed: {status}");
        std::fs::write(
            project.join("default.project.json"),
            r#"{ "name": "test", "tree": { "$path": "src" } }"#,
        )
        .unwrap();

        let session = ServeSession::new(Vfs::new(StdBackend::new().unwrap()), &project).unwrap();
        let initial_cursor = session.message_queue().cursor();
        assert_eq!(
            source_for_descendant(&session, "module").as_deref(),
            Some("return \"initial\"")
        );

        std::fs::write(target.join("module.lua"), "return \"physical\"").unwrap();
        wait_for_tree(&session, "apply a junction-target write", |session| {
            source_for_descendant(session, "module").as_deref() == Some("return \"physical\"")
        });

        std::fs::write(target.join("created.lua"), "return \"created\"").unwrap();
        wait_for_tree(&session, "add a child through a junction", |session| {
            source_for_descendant(session, "created").as_deref() == Some("return \"created\"")
        });

        assert!(
            session.message_queue().cursor() > initial_cursor,
            "serve session should publish applied junction updates"
        );
    }
}
